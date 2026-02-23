import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

class GeminiManager {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.tools = [];
        this.toolHandlers = {};
    }

    /**
     * Initialize Gemini client
     * @param {Array} tools - Function definitions for tool use
     * @param {Object} handlers - Map of function names to handler functions
     */
    init(tools = [], handlers = {}) {
        if (!config.gemini.apiKey) {
            throw new Error('GEMINI_API_KEY is not configured');
        }

        this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
        this.tools = tools;
        this.toolHandlers = handlers;

        // Load system prompt from DB if available, otherwise use default from config
        const storedPrompt = db.getConfig('system_prompt', null);
        this.systemPrompt = storedPrompt || config.gemini.systemPrompt;

        this._buildModel();

        logger.info('Gemini AI initialized', {
            model: config.gemini.model,
            toolsCount: tools.length,
            promptSource: storedPrompt ? 'database' : 'default'
        });

        return this;
    }

    /**
     * Re-initialize the model with a new system prompt
     * @param {string} newPrompt - The new system prompt
     */
    reinit(newPrompt) {
        this.systemPrompt = newPrompt;
        db.setConfig('system_prompt', newPrompt);
        this._buildModel();
        logger.info('Gemini model re-initialized with updated system prompt');
    }

    /**
     * Get the current system prompt
     */
    getSystemPrompt() {
        return this.systemPrompt;
    }

    /**
     * Build/rebuild the Gemini model with current settings
     */
    _buildModel() {
        this.model = this._getModel();
    }

    /**
     * Get a fresh GenerativeModel instance with dynamic date injection
     */
    _getModel() {
        if (!this.genAI) return this.model;

        // Inject current date and time into the system prompt
        const now = new Date();
        const options = { timeZone: 'Asia/Jerusalem' };
        const currentDate = now.toLocaleDateString('he-IL', options);
        const currentTime = now.toLocaleTimeString('he-IL', options);
        const dayOfWeek = now.toLocaleDateString('he-IL', { ...options, weekday: 'long' });

        const dynamicPrompt = `${this.systemPrompt}\n\n[SYSTEM INFO: Today is ${dayOfWeek}, ${currentDate}, Current time is ${currentTime}]`;

        return this.genAI.getGenerativeModel({
            model: config.gemini.model,
            systemInstruction: dynamicPrompt,
            tools: this.tools.length > 0 ? [{ functionDeclarations: this.tools }] : undefined,
            toolConfig: this.tools.length > 0 ? {
                functionCallingConfig: {
                    mode: 'AUTO'
                }
            } : undefined,
            safetySettings: [
                {
                    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH
                }
            ]
        });
    }

    /**
     * Process a text message
     * @param {string} userId - User identifier for context
     * @param {string} text - User message text
     */
    async processMessage(userId, text, options = {}) {
        logger.info('Processing message with Gemini', { userId, textLength: text.length });

        try {
            // Check if this is a device-related message
            const isDeviceRelated = this._isDeviceRelatedMessage(text);

            // For device-related messages, use minimal history to force fresh API calls
            // UNLESS keepHistory is set (e.g. from AI keywords that need context)
            let history = [];
            if (options.keepHistory || !isDeviceRelated) {
                history = this._buildHistory(userId);
            } else {
                logger.info('Device-related message detected - using empty history to force API calls');
            }

            // Start chat session
            const chat = this._getModel().startChat({
                history,
                generationConfig: {
                    maxOutputTokens: 1024,
                    temperature: 0.1  // Very low temperature for deterministic function calls
                }
            });

            // Store user message
            db.addChatMessage(userId, 'user', text);

            // Send message and get response
            let result = await chat.sendMessage(text);
            let response = result.response;

            // Debug: Log what Gemini returned
            const candidates = response.candidates;
            const functionCalls = response.functionCalls ? response.functionCalls() : null;
            const textPreview = response.text ? response.text().substring(0, 100) : '';
            logger.info('Gemini raw response', {
                historyLength: history.length,
                isDeviceRelated,
                hasFunctionCalls: !!(functionCalls && functionCalls.length > 0),
                functionCallsCount: functionCalls ? functionCalls.length : 0,
                candidatesCount: candidates ? candidates.length : 0,
                textPreview: textPreview
            });

            // Handle function calls
            response = await this._handleFunctionCalls(chat, response, userId);

            // Extract final text response
            const responseText = response.text();

            // Store assistant response
            db.addChatMessage(userId, 'model', responseText);

            // Log usage and cost
            if (result.response.usageMetadata) {
                const usage = result.response.usageMetadata;
                const inputTokens = usage.promptTokenCount || 0;
                const outputTokens = usage.candidatesTokenCount || 0;
                const totalTokens = usage.totalTokenCount || 0;

                // Pricing (Gemini 1.5 Flash estimation)
                // Input: $0.075 / 1M tokens
                // Output: $0.30 / 1M tokens
                const inputCost = (inputTokens / 1000000) * 0.075;
                const outputCost = (outputTokens / 1000000) * 0.30;
                const totalCost = inputCost + outputCost;

                try {
                    db.logUsage(config.gemini.model, inputTokens, outputTokens, totalTokens, totalCost);
                    logger.info('Usage logged', { inputTokens, outputTokens, totalCost: totalCost.toFixed(6) });
                } catch (err) {
                    logger.error('Failed to log usage', { error: err.message });
                }
            }

            logger.info('Gemini response generated', {
                userId,
                responseLength: responseText.length
            });

            return responseText;
        } catch (err) {
            logger.error('Gemini processing error', { error: err.message, userId });
            throw err;
        }
    }

    /**
     * Check if message is related to device control or status
     * @param {string} text - Message text
     * @returns {boolean}
     */
    _isDeviceRelatedMessage(text) {
        const lowerText = text.toLowerCase();
        const devicePatterns = [
            // Hebrew patterns
            'תדליק', 'תכבה', 'הדלק', 'כבה', 'להדליק', 'לכבות',
            'האור', 'אור', 'מנורה', 'תאורה', 'נורה',
            'מזגן', 'מיזוג', 'טמפרטורה',
            'מתג', 'שקע',
            'מה המצב', 'האם דולק', 'האם כבוי', 'האם פועל',
            'בדוק', 'תבדוק', 'בדקי', 'תבדקי',
            // English patterns  
            'turn on', 'turn off', 'switch on', 'switch off', 'toggle',
            'light', 'lamp', 'switch',
            'status', 'state', 'check',
            // Entity ID patterns
            'light.', 'switch.', 'sensor.', 'climate.',
            'tz3000', 'ts0004'  // Common Zigbee patterns
        ];

        return devicePatterns.some(pattern => lowerText.includes(pattern));
    }

    /**
     * Process a voice message (multimodal)
     * @param {string} userId - User identifier
     * @param {string} audioBase64 - Base64 encoded audio data
     * @param {string} mimeType - Audio MIME type
     */
    async processVoiceMessage(userId, audioBase64, mimeType) {
        logger.info('Processing voice message with Gemini', { userId, mimeType });

        try {
            // Get conversation history
            const history = this._buildHistory(userId);

            // Start chat session
            const chat = this._getModel().startChat({
                history,
                generationConfig: {
                    maxOutputTokens: 1024,
                    temperature: 0.7
                }
            });

            // Create multimodal content
            const audioPart = {
                inlineData: {
                    mimeType: mimeType,
                    data: audioBase64
                }
            };

            // Store reference to voice message
            db.addChatMessage(userId, 'user', '[Voice Message]');

            // Send audio for processing
            let result = await chat.sendMessage([
                audioPart,
                { text: 'Please listen to this voice message and respond appropriately. If it contains a request or question, handle it. If you need to use any tools/functions, please do so.' }
            ]);
            let response = result.response;

            // Handle function calls
            response = await this._handleFunctionCalls(chat, response, userId);

            // Extract final text response
            const responseText = response.text();

            // Store assistant response
            db.addChatMessage(userId, 'model', responseText);

            logger.info('Voice message processed', { userId, responseLength: responseText.length });

            return responseText;
        } catch (err) {
            logger.error('Voice message processing error', { error: err.message, userId });
            throw err;
        }
    }

    /**
     * Generate a broadcast message for a specific event
     * @param {Object} eventData - Data about the event (e.g., { event: "Dryer Finished" })
     */
    async generateBroadcastMessage(eventData) {
        logger.info('Generating broadcast message', { event: eventData.event });

        try {
            // Start chat session with no history
            const chat = this._getModel().startChat({
                generationConfig: {
                    maxOutputTokens: 1024,
                    temperature: 0.7 // Higher temperature for more creative/friendly announcements
                }
            });

            const prompt = `System Event: ${JSON.stringify(eventData)}
            
            Compose a short, friendly WhatsApp message to the family group announcing this event.
            Use emojis. respond in Hebrew.
            
            Example for "Dryer Finished":
            "המייבש סיים! 🧺 מי בא לו להוציא את הכביסה? 😉"
            
            Example for "Leak Detected":
            "⚠️ שימו לב! זוהתה נזילה במטבח. כדאי לבדוק את זה עכשיו!"
            
            Keep it under 2 sentences.`;

            // Send message and get response
            let result = await chat.sendMessage(prompt);
            let response = result.response;
            const responseText = response.text();

            logger.info('Broadcast message generated', { length: responseText.length });
            return responseText;
        } catch (err) {
            logger.error('Broadcast generation error', { error: err.message });
            // Fallback to simple message if AI fails
            return `עדכון מערכת: ${eventData.event}`;
        }
    }
    async _handleFunctionCalls(chat, response, userId) {
        let currentResponse = response;
        let iterations = 0;
        const maxIterations = 5; // Prevent infinite loops

        while (iterations < maxIterations) {
            const functionCalls = currentResponse.functionCalls();

            if (!functionCalls || functionCalls.length === 0) {
                break;
            }

            logger.info('Function call requested', {
                functions: functionCalls.map(fc => fc.name)
            });

            // Execute each function call
            const functionResponses = [];
            for (const functionCall of functionCalls) {
                const { name, args } = functionCall;

                // Log the function call
                db.logAction(userId, 'function_call', { name, args });

                let result;
                try {
                    if (this.toolHandlers[name]) {
                        result = await this.toolHandlers[name](args);
                        logger.info('Function executed', { name, result: typeof result });
                    } else {
                        result = { error: `Unknown function: ${name}` };
                        logger.warn('Unknown function called', { name });
                    }
                } catch (err) {
                    result = { error: err.message };
                    logger.error('Function execution error', { name, error: err.message });
                }

                functionResponses.push({
                    functionResponse: {
                        name,
                        response: result
                    }
                });
            }

            // Send function results back to model
            const functionResult = await chat.sendMessage(functionResponses);
            currentResponse = functionResult.response;
            iterations++;
        }

        return currentResponse;
    }

    /**
     * Build conversation history from database
     */
    _buildHistory(userId) {
        const messages = db.getChatHistory(userId, 20);

        // Convert to Gemini format
        let history = messages.map(msg => ({
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        // Gemini requires history to start with 'user' role
        // Remove any leading 'model' messages
        while (history.length > 0 && history[0].role === 'model') {
            history.shift();
        }

        // Also ensure alternating user/model pattern (Gemini requirement)
        // If two same roles in a row, merge them or remove duplicates
        const cleanedHistory = [];
        for (const msg of history) {
            if (cleanedHistory.length === 0 || cleanedHistory[cleanedHistory.length - 1].role !== msg.role) {
                cleanedHistory.push(msg);
            } else {
                // Merge with previous message of same role
                cleanedHistory[cleanedHistory.length - 1].parts[0].text += '\n' + msg.parts[0].text;
            }
        }

        return cleanedHistory;
    }

    /**
     * Clear conversation history for a user
     */
    clearHistory(userId) {
        logger.info('Clearing chat history', { userId });
        const deleted = db.clearChatHistory(userId);
        logger.info('Chat history cleared', { userId, deleted });
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            isInitialized: !!this.model,
            model: config.gemini.model,
            toolsCount: this.tools.length
        };
    }
}

export default new GeminiManager();
export { GeminiManager };
