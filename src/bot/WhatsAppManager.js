import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcodeTerminal from 'qrcode-terminal';
import qrcode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

class WhatsAppManager {
    constructor() {
        this.client = null;
        this.isReady = false;
        this.qrCode = null;
        this.onQrCodeCallback = null;
        this.onMessageCallback = null;
        this.onReadyCallback = null;
        this.onDisconnectedCallback = null;
    }

    /**
     * Initialize WhatsApp client
     */
    async init() {
        logger.info('Initializing WhatsApp client with Baileys...');

        // Ensure session directory exists for Baileys
        const sessionDir = config.whatsapp.sessionPath;
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        this.client = makeWASocket({
            auth: state,
            printQRInTerminal: false, // We handle QR printing manually
            logger: pino({ level: 'silent' }), // Suppress baileys internal logs or set to 'debug' for troubleshooting
            browser: ['Noga AI Assistant', 'Chrome', '1.0.0']
        });

        // Setup Event Handlers
        this.client.ev.on('creds.update', saveCreds);
        this._setupEventHandlers();

        return this;
    }

    /**
     * Set up WhatsApp event handlers
     */
    _setupEventHandlers() {
        // Connection events
        this.client.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info('QR Code received - scan to authenticate');
                this.qrCode = qr;

                // Display in terminal
                qrcodeTerminal.generate(qr, { small: true });

                // Generate base64 for dashboard
                try {
                    const qrDataUrl = await qrcode.toDataURL(qr);
                    if (this.onQrCodeCallback) {
                        this.onQrCodeCallback(qrDataUrl);
                    }
                } catch (err) {
                    logger.error('Failed to generate QR code image', { error: err.message });
                }
            }

            if (connection === 'close') {
                this.isReady = false;
                const statusCode = (lastDisconnect?.error)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 405;

                logger.warn('WhatsApp disconnected', { reason: lastDisconnect?.error, shouldReconnect });

                if (this.onDisconnectedCallback) {
                    this.onDisconnectedCallback(lastDisconnect?.error);
                }

                if (shouldReconnect) {
                    logger.info('Attempting to reconnect...');
                    setTimeout(() => this.init(), 5000);
                } else {
                    logger.warn('WhatsApp logged out automatically from the device. Purging session to generate fresh QR...');
                    this._purgeSessionAndRestart();
                }
            } else if (connection === 'open') {
                logger.info('WhatsApp client is ready!');
                this.isReady = true;
                this.qrCode = null;

                if (this.onReadyCallback) {
                    this.onReadyCallback();
                }
            }
        });

        // Message events
        this.client.ev.on('messages.upsert', async (m) => {
            // Only process new messages, ignore history syncs
            if (m.type !== 'notify') return;

            for (const msg of m.messages) {
                // Ignore our own messages
                if (msg.key.fromMe) continue;

                await this._handleMessage(msg);
            }
        });
    }

    /**
     * Purge the session folders safely and restart Baileys
     */
    _purgeSessionAndRestart() {
        if (this.client) {
            try {
                this.client.ws.close();
            } catch (err) {
                // Ignore
            }
            try {
                this.client.end(new Error('Purging session'));
            } catch (err) {
                // Ignore
            }
        }

        this.client = null;
        this.isReady = false;

        try {
            const sessionDir = path.resolve(process.cwd(), config.whatsapp.sessionPath);
            if (fs.existsSync(sessionDir)) {
                logger.info('Deleting WhatsApp session folder for a clean reconnect...', { sessionDir });
                fs.rmSync(sessionDir, { recursive: true, force: true });
            } else {
                logger.info('Session folder does not exist, skipping deletion', { sessionDir });
            }
        } catch (err) {
            logger.error('Failed to delete session directory', { error: err.message });
        }

        // Delay starting the new login process lightly to let IO finish
        setTimeout(() => this.init(), 3000);
    }

    /**
     * Manually log out the client
     */
    async logout() {
        if (this.client) {
            logger.info('Logging out of WhatsApp manually from the dashboard...');
            try {
                await this.client.logout();
            } catch (err) {
                logger.debug('Error executing Baileys logout', { error: err.message });
            }
            this.client = null;
            this.isReady = false;
        }

        // It's safer to always purge and restart manually too just in case Baileys fails to delete the keys gracefully
        this._purgeSessionAndRestart();
    }



    /**
     * Handle incoming messages
     */
    async _handleMessage(msg) {
        try {
            // Check if it's a protocol message or a status broadcast
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

            // Extract basic info
            const jid = msg.key.remoteJid;
            const isGroup = jid.endsWith('@g.us');
            const groupId = isGroup ? jid : null;

            // Extract sender - handle Linked Devices (@lid)
            let senderId;
            if (isGroup) {
                senderId = msg.key.participant ? msg.key.participant : jid;
            } else {
                // If it's an @lid, Baileys provides the real phone number in remoteJidAlt
                if (jid.endsWith('@lid') && msg.key.remoteJidAlt) {
                    senderId = msg.key.remoteJidAlt;
                } else {
                    senderId = jid;
                }
            }

            // Clean up suffixes to get the raw phone number
            senderId = senderId.replace('@s.whatsapp.net', '').replace('@lid', '').replace('@g.us', '');

            // Extract message content
            let messageContent = msg.message;

            // Unwrap ephemeral messages (Disappearing Messages)
            if (messageContent?.ephemeralMessage) {
                messageContent = messageContent.ephemeralMessage.message;
            }

            // Mark message as read
            try {
                await this.client.readMessages([msg.key]);
            } catch (err) {
                logger.debug('Failed to mark message as read', { error: err.message });
            }

            // Map message type - ignore metadata keys
            const keys = Object.keys(messageContent);
            const type = keys.find(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage') || keys[0];

            // Determine body
            let body = '';
            let hasMedia = false;
            let mediaData = null;

            if (type === 'conversation') {
                body = messageContent.conversation;
            } else if (type === 'extendedTextMessage') {
                body = messageContent.extendedTextMessage?.text;
            } else if (type === 'imageMessage') {
                body = messageContent.imageMessage?.caption;
                hasMedia = true;
            } else if (type === 'videoMessage') {
                body = messageContent.videoMessage?.caption;
                hasMedia = true;
            } else if (type === 'audioMessage' || type === 'pttMessage') {
                hasMedia = true;
            } else if (type === 'documentMessage') {
                hasMedia = true;
            }

            logger.info('Message received', {
                from: senderId,
                isGroup,
                groupId,
                rawType: type,
                hasMedia
            });

            if (senderId.includes('@lid')) {
                logger.info('LID Message Details', {
                    key: msg.key,
                    participant: msg.participant,
                    pushName: msg.pushName
                });
            }

            // Check whitelist using the exact same logic as before
            if (!this._isAllowed(senderId, groupId)) {
                logger.debug('Message ignored - not in whitelist', { senderId, groupId });
                return;
            }

            // Prepare the mapped message data structure identical to the old implementation
            const messageData = {
                id: msg.key.id,
                key: msg.key,
                from: senderId,
                chat: jid,
                isGroup,
                groupId,
                type: type === 'audioMessage' ? 'ptt' : type === 'conversation' || type === 'extendedTextMessage' ? 'chat' : type,
                body: body,
                timestamp: msg.messageTimestamp,
                hasMedia: hasMedia,
                media: null
            };

            // Download media for voice notes
            if (hasMedia && (type === 'audioMessage' || type === 'pttMessage')) {
                try {
                    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: this.client.updateMediaMessage
                    });

                    if (buffer) {
                        messageData.media = {
                            mimetype: messageContent.audioMessage.mimetype,
                            data: buffer.toString('base64'), // Base64 encoded
                            filename: 'audio.ogg' // Default for WA voice notes
                        };
                        logger.info('Voice message downloaded', {
                            mimetype: messageData.media.mimetype,
                            size: buffer.length
                        });
                    }
                } catch (err) {
                    logger.error('Failed to download media', { error: err.message });
                }
            }

            // Call message handler
            if (this.onMessageCallback) {
                await this.onMessageCallback(messageData);
            }
        } catch (err) {
            logger.error('Error handling message', { error: err.message });
        }
    }

    /**
     * Check if sender is allowed
     */
    _isAllowed(senderId, groupId) {
        // Check group whitelist
        if (config.whatsapp.groupId && groupId === config.whatsapp.groupId) {
            return true;
        }

        // Check phone number whitelist
        if (config.whatsapp.whitelist.length > 0) {
            return config.whatsapp.whitelist.includes(senderId);
        }

        // If no whitelist configured, deny all (security)
        return false;
    }

    /**
     * Send a text message
     */
    async sendMessage(chatId, text) {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        try {
            await this.client.sendMessage(chatId, { text: text });
            logger.info('Message sent', { to: chatId, length: text.length });
        } catch (err) {
            logger.error('Failed to send message', { error: err.message, to: chatId });
            throw err;
        }
    }

    /**
     * Send a message with media
     */
    async sendMediaMessage(chatId, mediaPath, caption = '') {
        if (!this.isReady) {
            throw new Error('WhatsApp client is not ready');
        }

        // Simplistic implementation for generic media sending using Baileys
        try {
            const buffer = fs.readFileSync(mediaPath);
            const ext = path.extname(mediaPath).toLowerCase();

            let messageContent = {};

            if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
                messageContent = { image: buffer, caption: caption };
            } else if (ext === '.mp4') {
                messageContent = { video: buffer, caption: caption };
            } else if (ext === '.ogg' || ext === '.mp3') {
                messageContent = { audio: buffer, mimetype: 'audio/mp4', ptt: true };
            } else {
                messageContent = { document: buffer, mimetype: 'application/octet-stream', fileName: path.basename(mediaPath), caption: caption };
            }

            await this.client.sendMessage(chatId, messageContent);
            logger.info('Media message sent', { to: chatId, caption });
        } catch (err) {
            logger.error('Failed to send media message', { error: err.message, to: chatId });
            throw err;
        }
    }

    /**
     * React to a message
     */
    async reactToMessage(key, emoji) {
        try {
            if (!this.client || !this.isReady || !key) return;

            const reactionMessage = {
                react: {
                    text: emoji,
                    key: key
                }
            };

            await this.client.sendMessage(key.remoteJid, reactionMessage);
        } catch (err) {
            logger.debug('Failed to react to message', { error: err.message });
        }
    }

    // ==================== Event Handlers ====================

    onQrCode(callback) {
        this.onQrCodeCallback = callback;
    }

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onReady(callback) {
        this.onReadyCallback = callback;
    }

    onDisconnected(callback) {
        this.onDisconnectedCallback = callback;
    }

    // ==================== Status ====================

    getStatus() {
        return {
            isReady: this.isReady,
            hasQrCode: !!this.qrCode
        };
    }

    /**
     * Destroy the client
     */
    async destroy() {
        if (this.client) {
            try {
                this.client.end(new Error('Destroy called'));
            } catch (e) {
                // Ignore
            }
            this.client = null;
            this.isReady = false;
        }
    }
}

export default new WhatsAppManager();
export { WhatsAppManager };
