import whatsappManager from './WhatsAppManager.js';
import geminiManager from './GeminiManager.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import config from '../utils/config.js';
import { getRecentLogs, readServerLogs } from '../utils/logger.js';


class MessageRouter {
    constructor() {
        this.processingQueue = new Map();
        this.lastMessageTime = new Map(); // Track last message time per user
        this.CONTEXT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    }

    /**
     * Initialize the message router
     */
    init() {
        // Set up message handler
        whatsappManager.onMessage(async (message) => {
            await this.routeMessage(message);
        });

        logger.info('Message router initialized');
        return this;
    }

    /**
     * Route incoming message to appropriate handler
     */
    async routeMessage(message) {
        const { from, chat, body, type, hasMedia, media } = message;

        // Auto-clear context after 10 minutes of inactivity
        const now = Date.now();
        const lastTime = this.lastMessageTime.get(from);
        if (lastTime && (now - lastTime) > this.CONTEXT_TIMEOUT_MS) {
            logger.info('Auto-clearing chat context (10 min inactivity)', { from });
            geminiManager.clearHistory(from);
        }
        this.lastMessageTime.set(from, now);

        // Skip if already processing a message from this user
        if (this.processingQueue.has(from)) {
            logger.debug('User already has message in queue', { from });
            return;
        }

        // Add to processing queue
        this.processingQueue.set(from, Date.now());

        try {
            let response;

            // Check for special commands
            if (body.startsWith('/')) {
                response = await this.handleCommand(message);
            }
            // Handle voice messages
            else if (hasMedia && (type === 'ptt' || type === 'audio') && media) {
                response = await this.handleVoiceMessage(message);
            }
            // Handle text messages
            else if (body && body.trim().length > 0) {
                response = await this.handleTextMessage(message);
            }
            // Ignore other message types
            else {
                logger.debug('Ignoring unsupported message type', { type });
                return;
            }

            // Send response
            if (response && response.trim().length > 0) {
                await whatsappManager.sendMessage(chat, response);
            } else {
                logger.warn('Empty response generated', { from });
                const fallbackMsg = 'סליחה, המערכת סיימה לעבד את הבקשה אבל לא ייצרה שום טקסט כתשובה. ייתכן שיש תקלה פנימית או שהפעולה בוצעה בשקט. 😅';
                await whatsappManager.sendMessage(chat, fallbackMsg);
                // Log fallback message to chat history
                db.addChatMessage(from, 'model', fallbackMsg);
            }
        } catch (err) {
            logger.error('Error processing message', { error: err.message, from });

            // Check if it's a quota error
            const isQuotaError = err.message && (err.message.includes('429') || err.message.toLowerCase().includes('quota'));

            // Send error message in Hebrew
            try {
                const errorMessage = isQuotaError
                    ? 'המכסה היומית של הבינה המלאכותית נגמרה 😅 אשתף פעולה שוב בקרוב!'
                    : `סליחה, נתקלתי בתקלה ולכן לא יכולתי לענות לבקשתך 😅\n\n*פרטי התקלה להבנת הבעיה:*\n${err.message}`;

                await whatsappManager.sendMessage(chat, errorMessage);
                // Log error message to chat history
                db.addChatMessage(from, 'model', errorMessage);
            } catch (sendErr) {
                logger.error('Failed to send error message', { error: sendErr.message });
            }
        } finally {
            // Remove from processing queue
            this.processingQueue.delete(from);
        }
    }

    /**
     * Handle text messages
     */
    async handleTextMessage(message) {
        const { from, body } = message;

        logger.info('Processing text message', { from, preview: body.substring(0, 50) });

        return await this.processText(from, body, message);
    }

    /**
     * Core text processing logic - shared between WhatsApp and Dashboard
     * @param {string} userId - ID for context tracking
     * @param {string} text - The input text
     * @param {Object} message - (Optional) The original WhatsApp message object
     */
    async processText(userId, text, message = null) {
        // Check for keyword match before sending to Gemini
        const keywordMatch = db.getKeywordByText(text.trim());
        if (keywordMatch) {
            logger.info('Keyword matched', { from: userId, keyword: keywordMatch.keyword, type: keywordMatch.type });

            if (keywordMatch.type === 'ai') {
                if (message) {
                    try { await whatsappManager.reactToMessage(message.key, '🤖'); } catch (e) {}
                }
                const augmentedMessage = `[Custom Instructions: ${keywordMatch.response}]\n\nUser message: ${text}`;
                return await geminiManager.processMessage(userId, augmentedMessage, { keepHistory: true });
            }

            // Static keyword: return the response directly
            if (message) {
                try { await whatsappManager.reactToMessage(message.key, '⚡'); } catch (e) {}
            }
            return keywordMatch.response;
        }

        // React to show we received the message (WhatsApp only)
        if (message) {
            try { await whatsappManager.reactToMessage(message.key, '🤖'); } catch (e) {}
        }

        // Process with Gemini, passing message context
        return await geminiManager.processMessage(userId, text, { message });
    }

    /**
     * Handle voice messages
     */
    async handleVoiceMessage(message) {
        const { from, chat, media } = message;

        logger.info('Processing voice message', { from });

        // React to show we're processing
        try {
            await whatsappManager.reactToMessage(message.key, '🎧');
        } catch {
            // Ignore reaction errors
        }

        // Process with Gemini multimodal
        const response = await geminiManager.processVoiceMessage(
            from,
            media.data,
            media.mimetype
        );

        return response;
    }

    /**
     * Handle special commands
     */
    async handleCommand(message) {
        const { from, body } = message;
        const command = body.toLowerCase().trim();

        logger.info('Processing command', { from, command });

        // Admin-only commands require ADMIN_PHONE to be configured and match the sender
        const adminPhone = config.whatsapp.adminPhone;
        const isAdmin = adminPhone && from === adminPhone;

        switch (command) {
            case '/help':
            case '/עזרה':
                return this.getHelpText(isAdmin);

            case '/status':
            case '/סטטוס':
                return this.getStatusText();

            case '/clear':
            case '/נקה':
                geminiManager.clearHistory(from);
                return 'היסטוריית השיחה נמחקה 🗑️';

            case '/log':
            case '/לוג': {
                if (!isAdmin) return '⛔ פקודה זו זמינה למנהל בלבד.';

                const formatLogLines = (entries) =>
                    entries.map(l => {
                        const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '??:??';
                        const level = (l.level || 'info').toUpperCase();
                        return `[${time}] ${level}: ${l.message}`;
                    }).join('\n');

                // 1️⃣ Live Log — in-memory buffer since last restart
                const liveLogs = getRecentLogs(30);
                const liveText = liveLogs.length > 0
                    ? formatLogLines(liveLogs)
                    : '(אין לוגים בזיכרון)';
                const liveMsg = `🟢 *לוג חי (מאז ההפעלה האחרונה):*\n\n\`\`\`\n${liveText}\n\`\`\``;

                // 2️⃣ Server Log — persistent file on disk
                const serverLogs = readServerLogs(30);
                const serverText = serverLogs.length > 0
                    ? formatLogLines(serverLogs)
                    : '(אין קובץ לוג)';
                const serverMsg = `📁 *לוג שרת (קובץ — 30 שורות אחרונות):*\n\n\`\`\`\n${serverText}\n\`\`\``;

                // from is a bare phone number — reconstruct full JID for Baileys
                const adminJid = from.includes('@') ? from : `${from}@s.whatsapp.net`;
                await whatsappManager.sendMessage(adminJid, liveMsg);
                return serverMsg;
            }

            case '/restart':
            case '/reset':
            case '/אתחול': {
                if (!isAdmin) return '⛔ פקודה זו זמינה למנהל בלבד.';
                // Send confirmation first, then restart after a short delay
                setTimeout(() => {
                    logger.warn('System restart requested via WhatsApp admin command');
                    process.exit(0); // Docker will auto-restart
                }, 2000);
                return '🔄 מאתחל מערכת... אחזור תוך כמה שניות!';
            }

            default:
                // Unknown command - pass to Gemini
                return geminiManager.processMessage(from, body);
        }
    }

    /**
     * Get help text
     */
    getHelpText(isAdmin = false) {
        const adminCommands = isAdmin ? `
*פקודות מנהל (Admin Only):*
/log - קבל 30 לוגים אחרונים של המערכת
/restart - אתחל את המערכת` : '';

        return `שלום! אני נוגה 👋
        
אני יכולה לעזור לך עם:

📅 *יומן* - "מה יש לי היום?", "הוסיפי פגישה מחר ב-10"
🛒 *קניות* - "תוסיפי חלב לרשימה", "מה ברשימת הקניות?"
🏠 *בית חכם* - "תדליקי אור בסלון", "מה הטמפרטורה?"

*פקודות:*
/status - סטטוס המערכת
/clear - נקה היסטוריית שיחה${adminCommands}

אפשר גם לשלוח הודעה קולית! 🎤`;
    }

    /**
     * Get system status
     */
    getStatusText() {
        const waStatus = whatsappManager.getStatus();
        const geminiStatus = geminiManager.getStatus();
        const usage = db.getUsageStats();

        const formatCost = (cost) => {
            return cost.toFixed(4);
        };

        return `📊 *סטטוס המערכת*

💬 *WhatsApp*: ${waStatus.isReady ? '✅ מחובר' : '❌ מנותק'}
🤖 *Gemini*: ${geminiStatus.isInitialized ? '✅ פעיל' : '❌ לא פעיל'}
   Model: ${geminiStatus.model}
   Skills: ${geminiStatus.toolsCount}

📉 *שימוש ועלויות*
📅 *היום:*
   Input: ${usage.today.input.toLocaleString()}
   Output: ${usage.today.output.toLocaleString()}
   Cost: $${formatCost(usage.today.cost)}

🗓️ *החודש:*
   Input: ${usage.month.input.toLocaleString()}
   Output: ${usage.month.output.toLocaleString()}
   Cost: $${formatCost(usage.month.cost)}`;
    }

}


export default new MessageRouter();
export { MessageRouter };
