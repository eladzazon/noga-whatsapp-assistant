import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseManager {
    constructor(dbPath = './data/noga.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    /**
     * Initialize the database connection and schema
     */
    init() {
        // Ensure data directory exists
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Open database connection
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        // Run schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        this.db.exec(schema);

        // Migrations: add type column to keywords if missing
        try {
            const cols = this.db.pragma('table_info(keywords)');
            if (cols.length > 0 && !cols.find(c => c.name === 'type')) {
                this.db.exec("ALTER TABLE keywords ADD COLUMN type TEXT DEFAULT 'static' CHECK(type IN ('static', 'ai'))");
                console.log('[Database] Migrated keywords table: added type column');
            }
        } catch { /* table may not exist yet */ }

        console.log('[Database] Initialized successfully');
        return this;
    }

    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    // ==================== Config Operations ====================

    /**
     * Get a configuration value
     * @param {string} key - Configuration key
     * @param {*} defaultValue - Default value if not found
     */
    getConfig(key, defaultValue = null) {
        const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
        const row = stmt.get(key);
        if (row) {
            try {
                return JSON.parse(row.value);
            } catch {
                return row.value;
            }
        }
        return defaultValue;
    }

    /**
     * Set a configuration value
     * @param {string} key - Configuration key
     * @param {*} value - Value to store
     */
    setConfig(key, value) {
        const stmt = this.db.prepare(`
            INSERT INTO config (key, value, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET 
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
        `);
        const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
        stmt.run(key, serialized);
    }

    /**
     * Get all configuration values
     */
    getAllConfig() {
        const stmt = this.db.prepare('SELECT key, value FROM config');
        const rows = stmt.all();
        const config = {};
        for (const row of rows) {
            try {
                config[row.key] = JSON.parse(row.value);
            } catch {
                config[row.key] = row.value;
            }
        }
        return config;
    }

    // ==================== Chat Context Operations ====================

    /**
     * Add a message to chat context
     * @param {string} userId - User identifier
     * @param {string} role - Message role (user, model, function)
     * @param {string} content - Message content
     * @param {object} functionCall - Optional function call data
     */
    addChatMessage(userId, role, content, functionCall = null) {
        const stmt = this.db.prepare(`
            INSERT INTO chat_context (user_id, role, content, function_call)
            VALUES (?, ?, ?, ?)
        `);
        const fcStr = functionCall ? JSON.stringify(functionCall) : null;
        stmt.run(userId, role, content, fcStr);
    }

    /**
     * Get chat history for a user
     * @param {string} userId - User identifier
     * @param {number} limit - Maximum messages to retrieve
     */
    getChatHistory(userId, limit = 20) {
        const stmt = this.db.prepare(`
            SELECT role, content, function_call, created_at
            FROM chat_context
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        `);
        const rows = stmt.all(userId, limit);
        return rows.reverse().map(row => ({
            role: row.role,
            content: row.content,
            functionCall: row.function_call ? JSON.parse(row.function_call) : null,
            createdAt: row.created_at
        }));
    }

    /**
     * Clear old chat history (keep last N messages per user)
     * @param {number} keepLast - Number of messages to keep per user
     */
    pruneOldMessages(keepLast = 50) {
        const stmt = this.db.prepare(`
            DELETE FROM chat_context
            WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id, user_id,
                           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
                    FROM chat_context
                ) WHERE rn <= ?
            )
        `);
        const result = stmt.run(keepLast);
        return result.changes;
    }

    /**
     * Clear all chat history for a specific user
     * @param {string} userId - User identifier
     */
    clearChatHistory(userId) {
        const stmt = this.db.prepare('DELETE FROM chat_context WHERE user_id = ?');
        const result = stmt.run(userId);
        return result.changes;
    }

    // ==================== Cache Operations ====================

    /**
     * Add an item to cache
     * @param {string} type - Cache type (e.g., 'failed_task', 'local_note')
     * @param {object} data - Data to cache
     */
    addToCache(type, data) {
        const stmt = this.db.prepare(`
            INSERT INTO cache (type, data) VALUES (?, ?)
        `);
        stmt.run(type, JSON.stringify(data));
    }

    /**
     * Get pending cache items by type
     * @param {string} type - Cache type
     */
    getPendingCache(type) {
        const stmt = this.db.prepare(`
            SELECT id, data, retry_count, created_at
            FROM cache
            WHERE type = ? AND status = 'pending'
            ORDER BY created_at ASC
        `);
        return stmt.all(type).map(row => ({
            id: row.id,
            data: JSON.parse(row.data),
            retryCount: row.retry_count,
            createdAt: row.created_at
        }));
    }

    /**
     * Update cache item status
     * @param {number} id - Cache item ID
     * @param {string} status - New status
     * @param {string} errorMessage - Optional error message
     */
    updateCacheStatus(id, status, errorMessage = null) {
        const stmt = this.db.prepare(`
            UPDATE cache 
            SET status = ?, 
                error_message = ?,
                retry_count = retry_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(status, errorMessage, id);
    }

    /**
     * Clear completed cache items older than specified days
     * @param {number} days - Days to keep
     */
    cleanOldCache(days = 7) {
        const stmt = this.db.prepare(`
            DELETE FROM cache
            WHERE status IN ('completed', 'failed')
            AND created_at < datetime('now', '-' || ? || ' days')
        `);
        return stmt.run(days).changes;
    }

    // ==================== Audit Log Operations ====================

    /**
     * Log an action
     * @param {string} userId - User identifier (optional)
     * @param {string} action - Action name
     * @param {object} details - Action details
     */
    logAction(userId, action, details = null) {
        const stmt = this.db.prepare(`
            INSERT INTO audit_log (user_id, action, details)
            VALUES (?, ?, ?)
        `);
        stmt.run(userId, action, details ? JSON.stringify(details) : null);
    }

    /**
     * Get recent audit logs
     * @param {number} limit - Maximum entries to retrieve
     */
    getRecentLogs(limit = 100) {
        const stmt = this.db.prepare(`
            SELECT user_id, action, details, created_at
            FROM audit_log
            ORDER BY created_at DESC
            LIMIT ?
        `);
        return stmt.all(limit).map(row => ({
            userId: row.user_id,
            action: row.action,
            details: row.details ? JSON.parse(row.details) : null,
            createdAt: row.created_at
        }));
    }

    // ==================== Keyword Operations ====================

    /**
     * Get all keywords
     */
    getKeywords() {
        const stmt = this.db.prepare('SELECT * FROM keywords ORDER BY keyword ASC');
        return stmt.all();
    }

    /**
     * Get enabled keywords only
     */
    getEnabledKeywords() {
        const stmt = this.db.prepare('SELECT * FROM keywords WHERE enabled = 1 ORDER BY keyword ASC');
        return stmt.all();
    }

    /**
     * Find a keyword by its text (case-insensitive exact match)
     * Supports comma-separated keywords like "עזרה,היי"
     * @param {string} text - The keyword text to search for
     */
    getKeywordByText(text) {
        const trimmedText = text.trim();

        // Get all enabled keywords
        const stmt = this.db.prepare('SELECT * FROM keywords WHERE enabled = 1');
        const keywords = stmt.all();

        // Check each keyword (which may contain comma-separated values)
        for (const kw of keywords) {
            const variants = kw.keyword.split(',').map(v => v.trim());
            if (variants.some(variant => variant === trimmedText)) {
                return kw;
            }
        }

        return null;
    }

    /**
     * Add a new keyword
     * @param {string} keyword - Keyword trigger text
     * @param {string} response - Response text (static) or custom instructions (ai)
     * @param {string} type - 'static' or 'ai'
     */
    addKeyword(keyword, response, type = 'static') {
        const stmt = this.db.prepare(`
            INSERT INTO keywords (keyword, response, type)
            VALUES (?, ?, ?)
        `);
        const result = stmt.run(keyword.trim(), response, type);
        return result.lastInsertRowid;
    }

    /**
     * Update an existing keyword
     * @param {number} id - Keyword ID
     * @param {string} keyword - New keyword text
     * @param {string} response - New response text or instructions
     * @param {boolean} enabled - Whether the keyword is enabled
     * @param {string} type - 'static' or 'ai'
     */
    updateKeyword(id, keyword, response, enabled, type = 'static') {
        const stmt = this.db.prepare(`
            UPDATE keywords 
            SET keyword = ?, response = ?, enabled = ?, type = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        stmt.run(keyword.trim(), response, enabled ? 1 : 0, type, id);
    }

    /**
     * Delete a keyword
     * @param {number} id - Keyword ID
     */
    deleteKeyword(id) {
        const stmt = this.db.prepare('DELETE FROM keywords WHERE id = ?');
        const result = stmt.run(id);
        return result.changes;
    }
}

// Export singleton instance
const db = new DatabaseManager();
export default db;
export { DatabaseManager };
