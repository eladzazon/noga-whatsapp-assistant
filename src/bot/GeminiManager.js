import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import fs from 'fs';
import path from 'path';

// Pricing per 1M tokens (USD) – update when Google changes rates
const MODEL_PRICING = {
    'gemini-3.5-flash':      { input: 1.50, output: 9.00 },
    'gemini-2.5-pro':        { input: 1.25, output: 10.00 },
    'gemini-2.5-flash':      { input: 0.30, output: 2.50 },
    'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
    'gemini-2.0-flash':      { input: 0.10, output: 0.40 },
    'gemini-1.5-flash':      { input: 0.35, output: 1.05 },
    'gemini-1.5-pro':        { input: 1.25, output: 5.00 },
};

/**
 * Get pricing for a model name, using prefix matching for versioned names
 * e.g. "gemini-2.5-flash-preview-05-20" matches "gemini-2.5-flash"
 */
function getModelPricing(modelName) {
    if (!modelName) return MODEL_PRICING['gemini-2.5-flash'];
    // Exact match first
    if (MODEL_PRICING[modelName]) return MODEL_PRICING[modelName];
    // Prefix match (longest first)
    const keys = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);
    for (const key of keys) {
        if (modelName.startsWith(key)) return MODEL_PRICING[key];
    }
    // Fallback
    return MODEL_PRICING['gemini-2.5-flash'];
}

class GeminiManager {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.tools = [];
        this.toolHandlers = {};
        this.quotaExceeded = false;
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

        // Load system prompt from files
        this.systemPrompt = this._buildDynamicSystemPrompt();

        this._buildModel();

        logger.info('Gemini AI initialized', {
            model: config.gemini.model,
            toolsCount: tools.length,
            promptSource: 'files'
        });

        return this;
    }

    /**
     * Build system prompt dynamically from Markdown files
     */
    _buildDynamicSystemPrompt() {
        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        
        // Base system prompt is ALWAYS included
        let promptParts = [config.gemini.systemPrompt];

        try {
            if (fs.existsSync(knowledgeDir)) {
                const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
                    promptParts.push(`--- BEGIN ${file} ---\n${content}\n--- END ${file} ---`);
                }
            }
        } catch (err) {
            logger.error('Failed to read knowledge files', { error: err.message });
        }

        try {
            if (fs.existsSync(skillsDir)) {
                const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
                if (files.length > 0) {
                    let skillsList = "--- BEGIN AVAILABLE SKILLS ---\nThese are the skills you know how to execute. You can use these procedures if asked.\n\n";
                    for (const file of files) {
                        const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
                        skillsList += `Skill File: ${file}\n${content}\n\n`;
                    }
                    skillsList += "--- END AVAILABLE SKILLS ---";
                    promptParts.push(skillsList);
                }
            }
        } catch (err) {
            logger.error('Failed to read skills files', { error: err.message });
        }

        return promptParts.join('\n\n');
    }


    /**
     * Re-initialize the model to pick up file changes
     */
    reinit() {
        this.systemPrompt = this._buildDynamicSystemPrompt();
        this._buildModel();
        logger.info('Gemini model re-initialized with updated system prompt from files');
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
        const utcISO = now.toISOString();

        // Inject pending reminders so the AI knows what the user might be referring to
        let pendingRemindersInfo = '';
        if (db) {
            const reminders = db.getPendingReminders();
            if (reminders && reminders.length > 0) {
                pendingRemindersInfo = `\nPending Reminders (To-Do): ${reminders.map(r => `[ID: ${r.id}] ${r.title}`).join(', ')}. If the user says "done", "I did it", or reacts with a thumbs up / "like" emoji (👍), check the chat history for the "[Internal Context: Reminder ID X]" tag to know exactly which task they are reacting to, and use update_reminder_status to mark it done. IMPORTANT: Never include "[Internal Context: ...]" tags in your responses to the user. These are internal system metadata only.`;
            }
        }

        const dynamicPrompt = `${this.systemPrompt}\n\n[SYSTEM INFO: Today is ${dayOfWeek}, ${currentDate}, Current local time is ${currentTime}, Current UTC ISO is ${utcISO}${pendingRemindersInfo}]`;

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
                    threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                    threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                    threshold: HarmBlockThreshold.BLOCK_NONE
                },
                {
                    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                    threshold: HarmBlockThreshold.BLOCK_NONE
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

        // Check if this is a volatile request (devices, calendar, etc)
        const isVolatileRequest = this._isVolatileRequestMessage(text);

        // Always use history to maintain context, even for volatile requests.
        let history = [];
        if (options.keepHistory === false) {
            logger.info('keepHistory explicitly false - using empty history');
        } else {
            history = this._buildHistory(userId);
        }

        // ── Context Awareness: inject a hint for short follow-up messages ──
        let textToSend = text;
        if (!isVolatileRequest && history.length > 0) {
            const wordCount = text.trim().split(/\s+/).length;
            if (wordCount <= 10 && !text.startsWith('[')) {
                const lastMsg = history[history.length - 1].parts[0].text;
                const truncatedLast = lastMsg.length > 100 ? lastMsg.substring(0, 100) + '...' : lastMsg;
                textToSend = `[Context Note: This is a short message following our last exchange: "${truncatedLast}". Please interpret this new message relative to that context.]\n${text}`;
                logger.info('Context hint injected (short follow-up)', { wordCount });
            }
        }

        // Store user message once
        db.addChatMessage(userId, 'user', text);

        const maxAttempts = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Start chat session
                const chat = this._getModel().startChat({
                    history: [...history],
                    generationConfig: {
                        maxOutputTokens: 1024,
                        temperature: 0.1  // Very low temperature for deterministic function calls
                    }
                });

                // Send message and get response
                let result;
                let actualTextToSend = textToSend;
                if (attempt > 1) {
                    actualTextToSend = `${textToSend}\n\n[System Note: Your previous attempt resulted in an empty response. Please rethink your approach. If you need information, use your tools (e.g. web_search). You must provide a valid response.]`;
                }

                try {
                    result = await chat.sendMessage(actualTextToSend);
                    this.quotaExceeded = false; // Reset on success
                } catch (err) {
                    if (err.message && (err.message.includes('429') || err.message.toLowerCase().includes('quota'))) {
                        this.quotaExceeded = true;
                    }
                    throw err;
                }
                let response = result.response;

                // Debug: Log what Gemini returned
                const candidates = response.candidates || [];
                const firstCandidate = candidates[0];
                const finishReason = firstCandidate ? firstCandidate.finishReason : 'NONE';
                const safetyRatings = firstCandidate ? firstCandidate.safetyRatings : [];
                
                const functionCalls = response.functionCalls ? response.functionCalls() : null;
                let textPreview = '';
                try {
                    textPreview = response.text ? response.text().substring(0, 100) : '';
                } catch (e) {
                    // Ignore, no text part
                }
                
                logger.info('Gemini raw response', {
                    attempt,
                    historyLength: history.length,
                    isVolatileRequest,
                    hasFunctionCalls: !!(functionCalls && functionCalls.length > 0),
                    functionCallsCount: functionCalls ? functionCalls.length : 0,
                    candidatesCount: candidates.length,
                    finishReason,
                    textPreview: textPreview
                });

                if (finishReason !== 'STOP' && finishReason !== 'NONE') {
                    logger.warn('Gemini response finished with unusual reason', { finishReason, safetyRatings });
                }

                // Handle function calls
                const functionCallResult = await this._handleFunctionCalls(chat, response, userId);
                response = functionCallResult.response;

                if (functionCallResult.hasUnknownFunction && attempt < maxAttempts) {
                    logger.warn(`Unknown function called on attempt ${attempt}. Retrying...`);
                    continue; // Retry
                }

                // Extract final text response
                let responseText = '';
                try {
                    responseText = response.text() || '';
                } catch (e) {
                    logger.debug('Failed to extract text from response, might be empty', { error: e.message });
                }

                // If the model finished function calls but generated no text, ask it to summarize
                if (!responseText || responseText.trim() === '') {
                    if (attempt < maxAttempts) {
                        logger.warn(`Gemini returned empty text on attempt ${attempt}. Retrying...`);
                        continue; // Retry
                    }

                    logger.warn('Gemini returned empty text after processing and all retries failed');
                    try {
                        let followUpPrompt;
                        if (functionCallResult.hasErrors) {
                            followUpPrompt = 'הפעולה הסתיימה עם שגיאות ולא החזרת טקסט. אנא הודע למשתמש שהייתה שגיאה בביצוע הבקשה.';
                        } else if (functionCallResult.totalFunctionsCalled > 0) {
                            followUpPrompt = 'הפעולה בוצעה אך לא החזרת טקסט. אנא כתוב הודעה קצרה וידידותית בעברית למשתמש המאשרת שהבקשה שלו טופלה.';
                        } else {
                            followUpPrompt = 'קיבלת הודעה אך החזרת טקסט ריק בלי לבצע אף פעולה ובלי לקרוא לאף פונקציה. אנא התנצל בפני המשתמש והסבר שלא הצלחת להשלים את הבקשה. אל תגיד שהבקשה טופלה בהצלחה.';
                        }
                        const followUp = await chat.sendMessage(followUpPrompt);
                        responseText = followUp.response.text();
                    } catch (e) {
                        logger.error('Failed to get summary response', { error: e.message });
                        if (functionCallResult.hasErrors) {
                            responseText = 'הייתה שגיאה בביצוע הבקשה. אנא נסה שוב. ⚠️';
                        } else if (functionCallResult.totalFunctionsCalled > 0) {
                            responseText = 'הפעולה בוצעה. 👍';
                        } else {
                            responseText = 'מצטער, לא הצלחתי להבין או לבצע את הבקשה. נסה לנסח מחדש. 😕';
                        }
                    }
                }

                // Strip any internal context tags that Gemini may have echoed
                responseText = responseText.replace(/\s*\[Internal Context:[^\]]*\]/gi, '').trim();

                // Store assistant response
                db.addChatMessage(userId, 'model', responseText);

                // Log usage and cost
                if (response.usageMetadata) {
                    const usage = response.usageMetadata;
                    const inputTokens = usage.promptTokenCount || 0;
                    const outputTokens = usage.candidatesTokenCount || 0;
                    const totalTokens = usage.totalTokenCount || 0;

                    // Pricing based on active model
                    const pricing = getModelPricing(config.gemini.model);
                    const inputCost = (inputTokens / 1000000) * pricing.input;
                    const outputCost = (outputTokens / 1000000) * pricing.output;
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
                    responseLength: responseText.length,
                    attempt
                });

                return responseText;
            } catch (err) {
                logger.error(`Gemini processing error on attempt ${attempt}`, { error: err.message, userId });
                if (attempt >= maxAttempts) {
                    throw err;
                }
            }
        }
    }

    /**
     * Check if message is related to volatile status (device control, calendar, etc).
     * @param {string} text - Message text
     * @returns {boolean}
     */
    _isVolatileRequestMessage(text) {
        const lowerText = text.toLowerCase();
        const volatilePatterns = [
            // Hebrew device patterns
            'תדליק', 'תכבה', 'הדלק', 'כבה', 'להדליק', 'לכבות',
            'האור', 'אור', 'מנורה', 'תאורה', 'נורה',
            'מזגן', 'מיזוג', 'טמפרטורה',
            'מתג', 'שקע',
            'מה המצב', 'האם דולק', 'האם כבוי', 'האם פועל',
            'בדוק', 'תבדוק', 'בדקי', 'תבדקי',
            // Hebrew calendar/volatile patterns
            'יומן', 'אירוע', 'אירועים', 'פגישה', 'פגישות', 'לוז', 'לו"ז', 'משימה', 'משימות',
            // English device & calendar patterns  
            'turn on', 'turn off', 'switch on', 'switch off', 'toggle',
            'light', 'lamp', 'switch',
            'status', 'state', 'check',
            'calendar', 'event', 'events', 'schedule', 'meeting', 'meetings',
            // Entity ID patterns
            'light.', 'switch.', 'sensor.', 'climate.',
            'tz3000', 'ts0004'  // Common Zigbee patterns
        ];

        return volatilePatterns.some(pattern => lowerText.includes(pattern));
    }

    /**
     * Process a voice message (multimodal)
     * @param {string} userId - User identifier
     * @param {string} audioBase64 - Base64 encoded audio data
     * @param {string} mimeType - Audio MIME type
     */
    async processVoiceMessage(userId, audioBase64, mimeType, senderId = null) {
        logger.info('Processing voice message with Gemini', { userId, mimeType });

        // Get conversation history
        const history = this._buildHistory(userId);

        // Store reference to voice message once
        const logMsg = senderId ? `[Voice Message from Sender: ${senderId}]` : '[Voice Message]';
        db.addChatMessage(userId, 'user', logMsg);

        const maxAttempts = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Start chat session
                const chat = this._getModel().startChat({
                    history: [...history],
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

                let senderHint = senderId ? `הודעה קולית זו נשלחה מקבוצה על ידי משתמש ${senderId}. ` : '';

                // Send audio for Hebrew transcription + response
                let result;
                try {
                    let textInstruction = `${senderHint}אתה מקבל הודעה קולית.\n1. תמלל את ההודעה במדויק.\n2. אם יש בה בקשה או שאלה - טפל בה (כולל שימוש בכלים אם צריך).\n3. אם ההקלטה ארוכה מ-30 שניות, הוסף סיכום קצר בראשית.\nענה בעברית.`;
                    
                    if (attempt > 1) {
                        textInstruction += `\n\n[System Note: Your previous attempt resulted in an empty response. Please rethink your approach. If you need information, use your tools (e.g. web_search). You must provide a valid response.]`;
                    }

                    result = await chat.sendMessage([
                        audioPart,
                        { text: textInstruction }
                    ]);
                    this.quotaExceeded = false;
                } catch (err) {
                    if (err.message && (err.message.includes('429') || err.message.toLowerCase().includes('quota'))) {
                        this.quotaExceeded = true;
                    }
                    throw err;
                }
                let response = result.response;

                // Handle function calls
                const functionCallResult = await this._handleFunctionCalls(chat, response, userId);
                response = functionCallResult.response;

                if (functionCallResult.hasUnknownFunction && attempt < maxAttempts) {
                    logger.warn(`Unknown function called on attempt ${attempt}. Retrying...`);
                    continue; // Retry
                }

                // Extract final text response
                let responseText = '';
                try {
                    responseText = response.text() || '';
                } catch (e) {
                    logger.debug('Failed to extract text from voice response', { error: e.message });
                }

                if (!responseText || responseText.trim() === '') {
                    if (attempt < maxAttempts) {
                        logger.warn(`Gemini returned empty text for voice message on attempt ${attempt}. Retrying...`);
                        continue; // Retry
                    }
                    logger.warn('Gemini returned empty text for voice message after all retries');
                    if (functionCallResult.hasErrors) {
                        responseText = 'הייתה שגיאה בביצוע הבקשה. אנא נסה שוב. ⚠️';
                    } else if (functionCallResult.totalFunctionsCalled > 0) {
                        responseText = 'הפעולה בוצעה. 👍';
                    } else {
                        responseText = 'מצטער, לא הצלחתי להבין או לבצע את הבקשה. נסה לנסח מחדש. 😕';
                    }
                }

                // Store assistant response
                db.addChatMessage(userId, 'model', responseText);

                logger.info('Voice message processed', { userId, responseLength: responseText.length, attempt });

                return responseText;
            } catch (err) {
                logger.error(`Voice message processing error on attempt ${attempt}`, { error: err.message, userId });
                if (attempt >= maxAttempts) {
                    throw err;
                }
            }
        }
    }

    /**
     * Generate a broadcast message for a specific event
     * @param {Object} eventData - Data about the event (e.g., { event: "Dryer Finished" })
     */
    async generateBroadcastMessage(eventData) {
        logger.info('Generating broadcast message', { event: eventData.event });

        try {
            // Use a lightweight, tool-less model instance for generating broadcasts
            // This prevents Gemini from trying to use the 'send_whatsapp_message' tool and returning an empty text response.
            const broadcastModel = this.genAI.getGenerativeModel({
                model: config.gemini.model,
                systemInstruction: "You are a helpful home assistant. Your job is to format system events into friendly, natural WhatsApp messages."
            });

            // Start chat session with no history
            const chat = broadcastModel.startChat({
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
        let hasUnknownFunction = false;
        let hasErrors = false;
        let totalFunctionsCalled = 0;

        while (iterations < maxIterations) {
            const functionCalls = currentResponse.functionCalls();

            if (!functionCalls || functionCalls.length === 0) {
                break;
            }

            totalFunctionsCalled += functionCalls.length;

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
                        if (result && typeof result === 'object' && result.error) {
                            hasErrors = true;
                        }
                    } else {
                        result = { error: `Unknown function: ${name}` };
                        logger.warn('Unknown function called', { name });
                        hasUnknownFunction = true;
                        hasErrors = true;
                    }
                } catch (err) {
                    result = { error: err.message };
                    logger.error('Function execution error', { name, error: err.message });
                    hasErrors = true;
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

        return {
            response: currentResponse,
            hasUnknownFunction,
            hasErrors,
            totalFunctionsCalled
        };
    }

    /**
     * Build conversation history from database
     */
    _buildHistory(userId) {
        const messages = db.getChatHistory(userId, 40);

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
            quotaExceeded: this.quotaExceeded,
            model: config.gemini.model,
            toolsCount: this.tools.length
        };
    }
}

export default new GeminiManager();
export { GeminiManager };
