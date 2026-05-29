import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

class ToolCallHandler {
    /**
     * @param {Object} options
     * @param {Object} options.toolHandlers - Map of function names to handler functions
     */
    constructor({ toolHandlers }) {
        this.toolHandlers = toolHandlers;
    }

    /**
     * Handle iterative function call loop (max 5 iterations)
     * @param {Object} chat - Gemini chat session
     * @param {Object} response - Gemini response object
     * @param {string} userId - User identifier
     * @returns {Object} { response, hasUnknownFunction, hasErrors, totalFunctionsCalled }
     */
    async handle(chat, response, userId) {
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
}

export { ToolCallHandler };
