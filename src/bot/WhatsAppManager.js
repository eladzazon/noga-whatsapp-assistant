import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
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
        logger.info('Initializing WhatsApp client...');

        // Ensure session directory exists
        const sessionDir = path.dirname(config.whatsapp.sessionPath);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: config.whatsapp.sessionPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                    '--mute-audio'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
            }
        });

        this._setupEventHandlers();

        // Initialize client and wait for ready or timeout
        try {
            await Promise.race([
                this.client.initialize(),
                new Promise((_, reject) =>
                    // Extended timeout for slow VMs
                    setTimeout(() => reject(new Error('WhatsApp initialization timeout')), 300000)
                )
            ]);
        } catch (err) {
            logger.error('WhatsApp initialization error', { error: err.message });
        }

        return this;
    }

    /**
     * Set up WhatsApp event handlers
     */
    _setupEventHandlers() {
        // QR Code event
        this.client.on('qr', async (qr) => {
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
        });

        // Ready event
        this.client.on('ready', () => {
            logger.info('WhatsApp client is ready!');
            this.isReady = true;
            this.qrCode = null;

            if (this.onReadyCallback) {
                this.onReadyCallback();
            }
        });

        // Authenticated event
        this.client.on('authenticated', () => {
            logger.info('WhatsApp authenticated successfully');
        });

        // Authentication failure
        this.client.on('auth_failure', (msg) => {
            logger.error('WhatsApp authentication failed', { error: msg });
            this.isReady = false;
        });

        // Disconnected event
        this.client.on('disconnected', (reason) => {
            logger.warn('WhatsApp disconnected', { reason });
            this.isReady = false;

            if (this.onDisconnectedCallback) {
                this.onDisconnectedCallback(reason);
            }
        });

        // Message event
        this.client.on('message', async (message) => {
            await this._handleMessage(message);
        });
    }

    /**
     * Handle incoming messages
     */
    async _handleMessage(message) {
        try {
            // Get sender info
            const contact = await message.getContact();
            const chat = await message.getChat();

            const senderId = contact.id.user; // Phone number without @c.us
            const isGroup = chat.isGroup;
            const groupId = isGroup ? chat.id._serialized : null;

            logger.info('Message received', {
                from: senderId,
                isGroup,
                groupId,
                type: message.type,
                hasMedia: message.hasMedia
            });

            // Check whitelist
            if (!this._isAllowed(senderId, groupId)) {
                logger.debug('Message ignored - not in whitelist', { senderId, groupId });
                return;
            }

            // Prepare message data
            const messageData = {
                id: message.id._serialized,
                from: senderId,
                chat: chat.id._serialized,
                isGroup,
                groupId,
                type: message.type,
                body: message.body,
                timestamp: message.timestamp,
                hasMedia: message.hasMedia,
                media: null
            };

            // Handle voice messages
            if (message.hasMedia && (message.type === 'ptt' || message.type === 'audio')) {
                try {
                    const media = await message.downloadMedia();
                    if (media) {
                        messageData.media = {
                            mimetype: media.mimetype,
                            data: media.data, // Base64 encoded
                            filename: media.filename
                        };
                        logger.info('Voice message downloaded', {
                            mimetype: media.mimetype,
                            size: media.data.length
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
            await this.client.sendMessage(chatId, text);
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

        try {
            const media = MessageMedia.fromFilePath(mediaPath);
            await this.client.sendMessage(chatId, media, { caption });
            logger.info('Media message sent', { to: chatId, caption });
        } catch (err) {
            logger.error('Failed to send media message', { error: err.message, to: chatId });
            throw err;
        }
    }

    /**
     * React to a message
     */
    async reactToMessage(messageId, emoji) {
        try {
            // Note: This might require specific whatsapp-web.js version
            const msg = await this.client.getMessageById(messageId);
            if (msg) {
                await msg.react(emoji);
            }
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
            await this.client.destroy();
            this.client = null;
            this.isReady = false;
        }
    }
}

export default new WhatsAppManager();
export { WhatsAppManager };
