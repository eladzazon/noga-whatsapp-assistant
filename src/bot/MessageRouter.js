import whatsappManager from './WhatsAppManager.js';
import geminiManager from './GeminiManager.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

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
            if (response) {
                await whatsappManager.sendMessage(chat, response);
            }
        } catch (err) {
            logger.error('Error processing message', { error: err.message, from });

            // Check if it's a quota error
            const isQuotaError = err.message && (err.message.includes('429') || err.message.toLowerCase().includes('quota'));

            // Send error message in Hebrew
            try {
                const errorMessage = isQuotaError
                    ? 'המכסה היומית של הבינה המלאכותית נגמרה 😅 אשתף פעולה שוב בקרוב!'
                    : 'סליחה, נתקלתי בבעיה 😅 אנא נסו שוב.';

                await whatsappManager.sendMessage(chat, errorMessage);
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

        // Check for keyword match before sending to Gemini
        const keywordMatch = db.getKeywordByText(body.trim());
        if (keywordMatch) {
            logger.info('Keyword matched', { from, keyword: keywordMatch.keyword, type: keywordMatch.type });

            if (keywordMatch.type === 'ai') {
                // AI keyword: send custom instructions + user message to Gemini
                try {
                    await whatsappManager.reactToMessage(message.key, '🤖');
                } catch {
                    // Ignore reaction errors
                }
                const augmentedMessage = `[Custom Instructions: ${keywordMatch.response}]\n\nUser message: ${body}`;
                const response = await geminiManager.processMessage(from, augmentedMessage, { keepHistory: true });
                return response;
            }

            // Static keyword: return the response directly
            try {
                await whatsappManager.reactToMessage(message.key, '⚡');
            } catch {
                // Ignore reaction errors
            }
            return keywordMatch.response;
        }

        // React to show we received the message (using robot for AI processing)
        try {
            await whatsappManager.reactToMessage(message.key, '🤖');
        } catch {
            // Ignore reaction errors
        }

        // Process with Gemini
        const response = await geminiManager.processMessage(from, body);

        return response;
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

        switch (command) {
            case '/help':
            case '/עזרה':
                return this.getHelpText();

            case '/status':
            case '/סטטוס':
                return this.getStatusText();

            case '/clear':
            case '/נקה':
                geminiManager.clearHistory(from);
                return 'היסטוריית השיחה נמחקה 🗑️';

            default:
                // Unknown command - pass to Gemini
                return geminiManager.processMessage(from, body);
        }
    }

    /**
     * Get help text
     */
    getHelpText() {
        return `שלום! אני נוגה 👋
        
אני יכולה לעזור לך עם:

📅 *יומן* - "מה יש לי היום?", "הוסיפי פגישה מחר ב-10"
🛒 *קניות* - "תוסיפי חלב לרשימה", "מה ברשימת הקניות?"
🏠 *בית חכם* - "תדליקי אור בסלון", "מה הטמפרטורה?"

*פקודות מיוחדות:*
/status - סטטוס המערכת
/clear - נקה היסטוריית שיחה

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
