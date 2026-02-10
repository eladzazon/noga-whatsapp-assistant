import { google } from 'googleapis';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

// Shopping list name options
const LIST_NAMES = ['Shopping', 'קניות', 'shopping', 'Grocery', 'groceries'];

class TasksManager {
    constructor() {
        this.tasks = null;
        this.auth = null;
        this.shoppingListId = null;
    }

    /**
     * Initialize Google Tasks with OAuth2
     */
    async init() {
        try {
            const { clientId, clientSecret, refreshToken } = config.google.oauth;

            if (!clientId || !clientSecret || !refreshToken) {
                logger.warn('Google OAuth credentials not configured');
                return this;
            }

            // Create OAuth2 client
            this.auth = new google.auth.OAuth2(clientId, clientSecret);
            this.auth.setCredentials({ refresh_token: refreshToken });

            // Create tasks client
            this.tasks = google.tasks({ version: 'v1', auth: this.auth });

            // Find or create shopping list
            await this._ensureShoppingList();

            logger.info('Google Tasks initialized', { listId: this.shoppingListId });
        } catch (err) {
            logger.error('Failed to initialize Tasks', { error: err.message });
        }

        return this;
    }

    /**
     * Check if tasks is available
     */
    isAvailable() {
        return !!this.tasks && !!this.shoppingListId;
    }

    /**
     * Find or create the shopping list
     */
    async _ensureShoppingList() {
        try {
            // Get all task lists
            const response = await this.tasks.tasklists.list();
            const lists = response.data.items || [];

            // Look for existing shopping list
            for (const list of lists) {
                if (LIST_NAMES.some(name =>
                    list.title.toLowerCase() === name.toLowerCase()
                )) {
                    this.shoppingListId = list.id;
                    logger.info('Found shopping list', { title: list.title, id: list.id });
                    return;
                }
            }

            // Create new shopping list
            const newList = await this.tasks.tasklists.insert({
                requestBody: { title: 'קניות' }
            });

            this.shoppingListId = newList.data.id;
            logger.info('Created shopping list', { id: this.shoppingListId });
        } catch (err) {
            logger.error('Failed to ensure shopping list', { error: err.message });
        }
    }

    /**
     * Add an item to the shopping list
     * @param {string} item - Item name
     */
    async addTask(item) {
        if (!this.isAvailable()) {
            // Cache locally
            db.addToCache('shopping_item', { item, action: 'add' });
            return {
                success: false,
                cached: true,
                message: 'לא מצליחה לגשת לרשימה, אבל רשמתי לעצמי.'
            };
        }

        try {
            const response = await this.tasks.tasks.insert({
                tasklist: this.shoppingListId,
                requestBody: { title: item }
            });

            logger.info('Task added', { item, id: response.data.id });

            return {
                success: true,
                task: {
                    id: response.data.id,
                    title: response.data.title
                }
            };
        } catch (err) {
            logger.error('Failed to add task', { error: err.message, item });

            // Cache for retry
            db.addToCache('shopping_item', { item, action: 'add' });

            return {
                success: false,
                error: err.message,
                cached: true,
                message: 'לא מצליחה לגשת לרשימה, אבל רשמתי לעצמי.'
            };
        }
    }

    /**
     * Get all open tasks from shopping list
     */
    async getTasks() {
        if (!this.isAvailable()) {
            // Return cached items if any
            const cached = db.getPendingCache('shopping_item');
            if (cached.length > 0) {
                return {
                    success: false,
                    cached: true,
                    items: cached.map(c => c.data.item),
                    message: 'הרשימה לא זמינה. אלה הפריטים ששמרתי מקומית:'
                };
            }
            return {
                success: false,
                error: 'Tasks not available'
            };
        }

        try {
            const response = await this.tasks.tasks.list({
                tasklist: this.shoppingListId,
                showCompleted: false,
                maxResults: 100
            });

            const items = (response.data.items || []).map(task => ({
                id: task.id,
                title: task.title,
                notes: task.notes || '',
                due: task.due || null
            }));

            logger.info('Tasks retrieved', { count: items.length });

            return {
                success: true,
                count: items.length,
                items
            };
        } catch (err) {
            logger.error('Failed to get tasks', { error: err.message });
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Complete a task (mark as done)
     * @param {string} itemName - Item name to complete (fuzzy match)
     */
    async completeTask(itemName) {
        if (!this.isAvailable()) {
            return {
                success: false,
                error: 'Tasks not available'
            };
        }

        try {
            // Get all tasks
            const response = await this.tasks.tasks.list({
                tasklist: this.shoppingListId,
                showCompleted: false
            });

            const items = response.data.items || [];

            // Find matching task (fuzzy match)
            const searchLower = itemName.toLowerCase().trim();
            const matchedTask = items.find(task =>
                task.title.toLowerCase().includes(searchLower) ||
                searchLower.includes(task.title.toLowerCase())
            );

            if (!matchedTask) {
                return {
                    success: false,
                    error: 'Item not found',
                    message: `לא מצאתי "${itemName}" ברשימה`
                };
            }

            // Mark as completed
            await this.tasks.tasks.patch({
                tasklist: this.shoppingListId,
                task: matchedTask.id,
                requestBody: { status: 'completed' }
            });

            logger.info('Task completed', { item: matchedTask.title });

            return {
                success: true,
                task: {
                    id: matchedTask.id,
                    title: matchedTask.title
                }
            };
        } catch (err) {
            logger.error('Failed to complete task', { error: err.message, item: itemName });
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Clear all completed tasks
     */
    async clearCompleted() {
        if (!this.isAvailable()) {
            return { success: false, error: 'Tasks not available' };
        }

        try {
            await this.tasks.tasks.clear({
                tasklist: this.shoppingListId
            });

            logger.info('Completed tasks cleared');
            return { success: true };
        } catch (err) {
            logger.error('Failed to clear completed tasks', { error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Delete a specific task
     * @param {string} itemName - Item name to delete
     */
    async deleteTask(itemName) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Tasks not available' };
        }

        try {
            // Get all tasks
            const response = await this.tasks.tasks.list({
                tasklist: this.shoppingListId
            });

            const items = response.data.items || [];

            // Find matching task
            const searchLower = itemName.toLowerCase().trim();
            const matchedTask = items.find(task =>
                task.title.toLowerCase().includes(searchLower)
            );

            if (!matchedTask) {
                return { success: false, message: `לא מצאתי "${itemName}"` };
            }

            // Delete task
            await this.tasks.tasks.delete({
                tasklist: this.shoppingListId,
                task: matchedTask.id
            });

            logger.info('Task deleted', { item: matchedTask.title });
            return { success: true, deleted: matchedTask.title };
        } catch (err) {
            logger.error('Failed to delete task', { error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            available: this.isAvailable(),
            listId: this.shoppingListId
        };
    }
}

export default new TasksManager();
export { TasksManager };
