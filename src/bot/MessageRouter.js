import whatsappManager from './WhatsAppManager.js';
import geminiManager from './GeminiManager.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

class MessageRouter {
    constructor() {
        this.processingQueue = new Map();
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

            // Send error message in Hebrew
            try {
                await whatsappManager.sendMessage(
                    chat,
                    'סליחה, נתקלתי בבעיה 😅 אנא נסו שוב.'
                );
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

        // React to show we received the message
        try {
            await whatsappManager.reactToMessage(message.id, '👀');
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
        const { from, media } = message;

        logger.info('Processing voice message', { from });

        // React to show we're processing
        try {
            await whatsappManager.reactToMessage(message.id, '🎧');
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

        return `📊 *סטטוס המערכת*

💬 WhatsApp: ${waStatus.isReady ? '✅ מחובר' : '❌ מנותק'}
🤖 Gemini: ${geminiStatus.isInitialized ? '✅ פעיל' : '❌ לא פעיל'}
   Model: ${geminiStatus.model}
   Skills: ${geminiStatus.toolsCount}`;
    }
}

export default new MessageRouter();
export { MessageRouter };
