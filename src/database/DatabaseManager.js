import pg from 'pg';
import logger from '../utils/logger.js';
import { runMigrations } from '../../scripts/run_migrations.js';

const { Pool } = pg;

class DatabaseManager {
    constructor(connectionString = process.env.DB_URL) {
        this.connectionString = connectionString;
        this.pool = null;
        // In-memory keyword cache, keyed by tenantId (invalidated on any write to that tenant's keywords)
        this._keywordCache = new Map();
    }

    /**
     * Initialize the connection pool and apply any pending schema migrations
     */
    async init() {
        this.pool = new Pool({ connectionString: this.connectionString });
        await this.pool.query('SELECT 1'); // fail fast if Postgres is unreachable
        await runMigrations(this.pool);
        logger.info('[Database] Initialized successfully (Postgres)');
        return this;
    }

    /**
     * Close the database connection
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    // ==================== Instance Operations ====================
    // (Block 1's version/status surfaces; instance is a global singleton, not tenant-scoped)

    async getInstanceInfo() {
        const { rows } = await this.pool.query(
            `SELECT instance_id, current_version, schema_version, last_update_check,
                    last_known_latest_version, update_notification_dismissed_at
             FROM instance WHERE instance_id = 'default'`
        );
        return rows[0] || null;
    }

    async setInstanceVersion(version) {
        await this.pool.query(
            `UPDATE instance SET current_version = $1 WHERE instance_id = 'default'`,
            [version]
        );
    }

    // ==================== Config Operations ====================

    async getConfig(tenantId, key, defaultValue = null) {
        const { rows } = await this.pool.query(
            'SELECT value FROM config WHERE tenant_id = $1 AND key = $2',
            [tenantId, key]
        );
        if (rows.length > 0) {
            try {
                return JSON.parse(rows[0].value);
            } catch {
                return rows[0].value;
            }
        }
        return defaultValue;
    }

    async setConfig(tenantId, key, value) {
        const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
        await this.pool.query(
            `INSERT INTO config (tenant_id, key, value, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (tenant_id, key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at`,
            [tenantId, key, serialized]
        );
    }

    async getAllConfig(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT key, value FROM config WHERE tenant_id = $1',
            [tenantId]
        );
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

    async addChatMessage(tenantId, userId, role, content, functionCall = null) {
        const fcStr = functionCall ? JSON.stringify(functionCall) : null;
        await this.pool.query(
            `INSERT INTO chats (tenant_id, user_id, role, content, function_call)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, userId, role, content, fcStr]
        );
    }

    async getChatHistory(tenantId, userId, limit = 20) {
        const { rows } = await this.pool.query(
            `SELECT role, content, function_call, created_at
             FROM chats
             WHERE tenant_id = $1 AND user_id = $2
             ORDER BY created_at DESC
             LIMIT $3`,
            [tenantId, userId, limit]
        );
        return rows.reverse().map(row => ({
            role: row.role,
            content: row.content,
            functionCall: row.function_call ? JSON.parse(row.function_call) : null,
            createdAt: row.created_at
        }));
    }

    async pruneOldMessages(tenantId, keepLast = 50) {
        const { rowCount } = await this.pool.query(
            `DELETE FROM chats
             WHERE tenant_id = $1 AND id NOT IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
                    FROM chats WHERE tenant_id = $1
                ) ranked WHERE rn <= $2
             )`,
            [tenantId, keepLast]
        );
        return rowCount;
    }

    async clearChatHistory(tenantId, userId) {
        const { rowCount } = await this.pool.query(
            'DELETE FROM chats WHERE tenant_id = $1 AND user_id = $2',
            [tenantId, userId]
        );
        return rowCount;
    }

    // ==================== Cache Operations ====================

    async addToCache(tenantId, type, data) {
        await this.pool.query(
            'INSERT INTO cache (tenant_id, type, data) VALUES ($1, $2, $3)',
            [tenantId, type, JSON.stringify(data)]
        );
    }

    async getPendingCache(tenantId, type) {
        const { rows } = await this.pool.query(
            `SELECT id, data, retry_count, created_at
             FROM cache
             WHERE tenant_id = $1 AND type = $2 AND status = 'pending'
             ORDER BY created_at ASC`,
            [tenantId, type]
        );
        return rows.map(row => ({
            id: row.id,
            data: JSON.parse(row.data),
            retryCount: row.retry_count,
            createdAt: row.created_at
        }));
    }

    async updateCacheStatus(tenantId, id, status, errorMessage = null) {
        await this.pool.query(
            `UPDATE cache
             SET status = $1, error_message = $2, retry_count = retry_count + 1, updated_at = now()
             WHERE tenant_id = $3 AND id = $4`,
            [status, errorMessage, tenantId, id]
        );
    }

    async cleanOldCache(tenantId, days = 7) {
        const { rowCount } = await this.pool.query(
            `DELETE FROM cache
             WHERE tenant_id = $1 AND status IN ('completed', 'failed')
             AND created_at < now() - make_interval(days => $2::integer)`,
            [tenantId, days]
        );
        return rowCount;
    }

    // ==================== Audit Log Operations ====================

    async logAction(tenantId, userId, action, details = null) {
        await this.pool.query(
            'INSERT INTO audit_log (tenant_id, user_id, action, details) VALUES ($1, $2, $3, $4)',
            [tenantId, userId, action, details ? JSON.stringify(details) : null]
        );
    }

    async getRecentLogs(tenantId, limit = 100) {
        const { rows } = await this.pool.query(
            `SELECT user_id, action, details, created_at
             FROM audit_log WHERE tenant_id = $1
             ORDER BY created_at DESC LIMIT $2`,
            [tenantId, limit]
        );
        return rows.map(row => ({
            userId: row.user_id,
            action: row.action,
            details: row.details ? JSON.parse(row.details) : null,
            createdAt: row.created_at
        }));
    }

    // ==================== Keyword Operations ====================

    async getKeywords(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM keywords WHERE tenant_id = $1 ORDER BY keyword ASC',
            [tenantId]
        );
        return rows;
    }

    async getEnabledKeywords(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM keywords WHERE tenant_id = $1 AND enabled = TRUE ORDER BY keyword ASC',
            [tenantId]
        );
        return rows;
    }

    /**
     * Find a keyword by its text (case-insensitive exact match)
     * Supports comma-separated keywords like "עזרה,היי"
     * Uses an in-memory cache (per tenant) to avoid a full table scan on every message.
     */
    async getKeywordByText(tenantId, text) {
        const trimmedText = text.trim();

        if (!this._keywordCache.has(tenantId)) {
            const { rows } = await this.pool.query(
                'SELECT * FROM keywords WHERE tenant_id = $1 AND enabled = TRUE',
                [tenantId]
            );
            this._keywordCache.set(tenantId, rows);
        }

        const keywords = this._keywordCache.get(tenantId);
        for (const kw of keywords) {
            const variants = kw.keyword.split(',').map(v => v.trim());
            if (variants.some(variant => variant === trimmedText)) {
                return kw;
            }
        }

        return null;
    }

    async addKeyword(tenantId, keyword, response, type = 'static') {
        const { rows } = await this.pool.query(
            `INSERT INTO keywords (tenant_id, keyword, response, type)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [tenantId, keyword.trim(), response, type]
        );
        this._keywordCache.delete(tenantId);
        return rows[0].id;
    }

    async updateKeyword(tenantId, id, keyword, response, enabled, type = 'static') {
        await this.pool.query(
            `UPDATE keywords
             SET keyword = $1, response = $2, enabled = $3, type = $4, updated_at = now()
             WHERE tenant_id = $5 AND id = $6`,
            [keyword.trim(), response, !!enabled, type, tenantId, id]
        );
        this._keywordCache.delete(tenantId);
    }

    async deleteKeyword(tenantId, id) {
        await this.pool.query('DELETE FROM keywords WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
        this._keywordCache.delete(tenantId);
    }

    async clearKeywords(tenantId) {
        await this.pool.query('DELETE FROM keywords WHERE tenant_id = $1', [tenantId]);
        this._keywordCache.delete(tenantId);
    }

    // ==================== Scheduled Prompt Operations ====================

    async getScheduledPrompts(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM scheduled_prompts WHERE tenant_id = $1 ORDER BY name ASC',
            [tenantId]
        );
        return rows;
    }

    async getEnabledScheduledPrompts(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM scheduled_prompts WHERE tenant_id = $1 AND enabled = TRUE ORDER BY name ASC',
            [tenantId]
        );
        return rows;
    }

    async addScheduledPrompt(tenantId, name, prompt, cronExpression, enabled = true) {
        const { rows } = await this.pool.query(
            `INSERT INTO scheduled_prompts (tenant_id, name, prompt, cron_expression, enabled)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [tenantId, name.trim(), prompt.trim(), cronExpression.trim(), !!enabled]
        );
        return rows[0].id;
    }

    async updateScheduledPrompt(tenantId, id, name, prompt, cronExpression, enabled) {
        await this.pool.query(
            `UPDATE scheduled_prompts
             SET name = $1, prompt = $2, cron_expression = $3, enabled = $4, updated_at = now()
             WHERE tenant_id = $5 AND id = $6`,
            [name.trim(), prompt.trim(), cronExpression.trim(), !!enabled, tenantId, id]
        );
    }

    async deleteScheduledPrompt(tenantId, id) {
        await this.pool.query('DELETE FROM scheduled_prompts WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    }

    async clearScheduledPrompts(tenantId) {
        await this.pool.query('DELETE FROM scheduled_prompts WHERE tenant_id = $1', [tenantId]);
    }

    // ==================== Home Assistant Mapping Operations ====================

    async getHaMappings(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM ha_mappings WHERE tenant_id = $1 ORDER BY location ASC, nickname ASC',
            [tenantId]
        );
        return rows;
    }

    async addHaMapping(tenantId, entityId, nickname, location = null, type = null) {
        const { rows } = await this.pool.query(
            `INSERT INTO ha_mappings (tenant_id, entity_id, nickname, location, type)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [tenantId, entityId.trim(), nickname.trim(), location ? location.trim() : null, type ? type.trim() : null]
        );
        return rows[0].id;
    }

    async updateHaMapping(tenantId, id, entityId, nickname, location, type) {
        await this.pool.query(
            `UPDATE ha_mappings
             SET entity_id = $1, nickname = $2, location = $3, type = $4, updated_at = now()
             WHERE tenant_id = $5 AND id = $6`,
            [entityId.trim(), nickname.trim(), location ? location.trim() : null, type ? type.trim() : null, tenantId, id]
        );
    }

    async deleteHaMapping(tenantId, id) {
        await this.pool.query('DELETE FROM ha_mappings WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    }

    async clearHaMappings(tenantId) {
        await this.pool.query('DELETE FROM ha_mappings WHERE tenant_id = $1', [tenantId]);
    }

    async findHaMappingsByName(tenantId, query, type = null) {
        const search = `%${query.trim()}%`;
        let sql = 'SELECT * FROM ha_mappings WHERE tenant_id = $1 AND (nickname ILIKE $2 OR location ILIKE $2)';
        const params = [tenantId, search];

        if (type) {
            sql += ' AND type = $3';
            params.push(type);
        }

        sql += ' ORDER BY nickname ASC';

        const { rows } = await this.pool.query(sql, params);
        return rows;
    }

    // ==================== Usage Tracking ====================

    async logUsage(tenantId, model, inputTokens, outputTokens, totalTokens, cost) {
        await this.pool.query(
            `INSERT INTO usage_logs (tenant_id, model, input_tokens, output_tokens, total_tokens, cost_usd)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [tenantId, model, inputTokens, outputTokens, totalTokens, cost]
        );
    }

    async getUsageStats(tenantId) {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const query = `
            SELECT
                SUM(input_tokens) as input,
                SUM(output_tokens) as output,
                SUM(total_tokens) as total,
                SUM(cost_usd) as cost
            FROM usage_logs
            WHERE tenant_id = $1 AND timestamp >= $2
        `;

        const [todayRes, monthRes] = await Promise.all([
            this.pool.query(query, [tenantId, startOfDay]),
            this.pool.query(query, [tenantId, startOfMonth])
        ]);

        const today = todayRes.rows[0];
        const month = monthRes.rows[0];

        return {
            today: {
                input: Number(today.input) || 0,
                output: Number(today.output) || 0,
                total: Number(today.total) || 0,
                cost: Number(today.cost) || 0
            },
            month: {
                input: Number(month.input) || 0,
                output: Number(month.output) || 0,
                total: Number(month.total) || 0,
                cost: Number(month.cost) || 0
            }
        };
    }

    // ==================== Reminders ====================

    async addReminder(tenantId, title, dueDate, nudgeIntervalMinutes = 60) {
        const { rows } = await this.pool.query(
            'INSERT INTO reminders (tenant_id, title, due_date, nudge_interval_minutes) VALUES ($1, $2, $3, $4) RETURNING id',
            [tenantId, title, dueDate, nudgeIntervalMinutes]
        );
        return rows[0].id;
    }

    async updateReminderStatus(tenantId, id, status) {
        const { rowCount } = await this.pool.query(
            'UPDATE reminders SET status = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3',
            [status, tenantId, id]
        );
        return rowCount > 0;
    }

    async updateReminderDueDate(tenantId, id, dueDate) {
        const { rowCount } = await this.pool.query(
            `UPDATE reminders
             SET due_date = $1, status = 'pending', last_nudged = NULL, nudge_count = 0, updated_at = now()
             WHERE tenant_id = $2 AND id = $3`,
            [dueDate, tenantId, id]
        );
        return rowCount > 0;
    }

    async updateReminderLastNudged(tenantId, id) {
        const { rowCount } = await this.pool.query(
            'UPDATE reminders SET last_nudged = now(), nudge_count = nudge_count + 1 WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
        return rowCount > 0;
    }

    async getPendingReminders(tenantId) {
        const { rows } = await this.pool.query(
            "SELECT * FROM reminders WHERE tenant_id = $1 AND status = 'pending'",
            [tenantId]
        );
        return rows;
    }

    async getAllReminders(tenantId) {
        const { rows } = await this.pool.query(
            'SELECT * FROM reminders WHERE tenant_id = $1 ORDER BY created_at DESC',
            [tenantId]
        );
        return rows;
    }

    async updateReminder(tenantId, id, title, dueDate, nudgeInterval) {
        const { rowCount } = await this.pool.query(
            'UPDATE reminders SET title = $1, due_date = $2, nudge_interval_minutes = $3 WHERE tenant_id = $4 AND id = $5',
            [title, dueDate, nudgeInterval, tenantId, id]
        );
        return rowCount > 0;
    }

    async clearReminders(tenantId) {
        await this.pool.query('DELETE FROM reminders WHERE tenant_id = $1', [tenantId]);
    }

    /**
     * Directly set a reminder's timestamp/count fields (used by backup restore, which
     * needs to reproduce historical last_nudged/nudge_count/created_at/updated_at exactly).
     */
    async setReminderTimestamps(tenantId, id, { lastNudged, nudgeCount, createdAt, updatedAt }) {
        const { rowCount } = await this.pool.query(
            `UPDATE reminders
             SET last_nudged = $1, nudge_count = $2, created_at = $3, updated_at = $4
             WHERE tenant_id = $5 AND id = $6`,
            [lastNudged, nudgeCount || 0, createdAt, updatedAt, tenantId, id]
        );
        return rowCount > 0;
    }

    /**
     * Record a nudge message ID for a reminder (keeps ALL nudge IDs, not just the latest).
     * Scoped via a join so a message can only be attached to a reminder owned by tenantId.
     */
    async addReminderNudgeMessage(tenantId, reminderId, messageId) {
        const { rowCount } = await this.pool.query(
            `INSERT INTO reminder_nudge_messages (message_id, reminder_id)
             SELECT $1, id FROM reminders WHERE id = $2 AND tenant_id = $3
             ON CONFLICT (message_id) DO NOTHING`,
            [messageId, reminderId, tenantId]
        );
        return rowCount > 0;
    }

    async getReminderByNudgeMessageId(tenantId, messageId) {
        const { rows } = await this.pool.query(
            `SELECT r.* FROM reminders r
             JOIN reminder_nudge_messages m ON m.reminder_id = r.id
             WHERE m.message_id = $1 AND r.tenant_id = $2 AND r.status = 'pending'`,
            [messageId, tenantId]
        );
        return rows[0] || null;
    }

    async deleteReminder(tenantId, id) {
        const { rowCount } = await this.pool.query(
            'DELETE FROM reminders WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
        return rowCount > 0;
    }

    /**
     * Delete reminders with status 'done' or 'cancelled' that were updated more than N days ago
     */
    async pruneExpiredReminders(tenantId, days = 1) {
        await this.pool.query(
            `DELETE FROM reminder_nudge_messages
             WHERE reminder_id IN (
                SELECT id FROM reminders
                WHERE tenant_id = $1 AND status IN ('done', 'cancelled')
                AND updated_at < now() - make_interval(days => $2::integer)
             )`,
            [tenantId, days]
        );

        const { rowCount } = await this.pool.query(
            `DELETE FROM reminders
             WHERE tenant_id = $1 AND status IN ('done', 'cancelled')
             AND updated_at < now() - make_interval(days => $2::integer)`,
            [tenantId, days]
        );
        return rowCount;
    }
}

// Export singleton instance
const db = new DatabaseManager();
export default db;
export { DatabaseManager };
