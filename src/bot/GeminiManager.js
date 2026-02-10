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

        // Configure the model
        this.model = this.genAI.getGenerativeModel({
            model: config.gemini.model,
            systemInstruction: config.gemini.systemPrompt,
            tools: tools.length > 0 ? [{ functionDeclarations: tools }] : undefined,
            toolConfig: tools.length > 0 ? {
                functionCallingConfig: {
                    mode: 'AUTO' // AUTO lets model decide, ANY forces function calls
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

        logger.info('Gemini AI initialized', {
            model: config.gemini.model,
            toolsCount: tools.length
        });

        return this;
    }

    /**
     * Process a text message
     * @param {string} userId - User identifier for context
     * @param {string} text - User message text
     */
    async processMessage(userId, text) {
        logger.info('Processing message with Gemini', { userId, textLength: text.length });

        try {
            // Check if this is a device-related message
            const isDeviceRelated = this._isDeviceRelatedMessage(text);

            // For device-related messages, use minimal history to force fresh API calls
            // Otherwise Gemini may answer from memory instead of calling functions
            let history = [];
            if (!isDeviceRelated) {
                history = this._buildHistory(userId);
            } else {
                logger.info('Device-related message detected - using empty history to force API calls');
            }

            // Start chat session
            const chat = this.model.startChat({
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
            const chat = this.model.startChat({
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
     * Handle function calls recursively
     */
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
