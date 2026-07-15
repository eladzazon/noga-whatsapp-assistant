import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import pg from 'pg';
import logger from '../src/utils/logger.js';
import { runMigrations } from './run_migrations.js';

dotenv.config();

const TENANT_ID = process.env.DEFAULT_TENANT_ID || 'family_core';
const SQLITE_PATH = process.env.DATABASE_PATH || './data/noga.db';

function parseList(value) {
    if (!value) return [];
    return value.split(',').map(s => s.trim()).filter(Boolean);
}

// SQLite's CURRENT_TIMESTAMP writes 'YYYY-MM-DD HH:MM:SS' with no timezone marker, but it is
// UTC by convention. Without an explicit 'Z', Postgres would interpret it in the session
// timezone instead of UTC, silently shifting every migrated timestamp. Values that already
// carry a timezone (application-generated ISO strings like due_date) pass through unchanged.
function normalizeTimestamp(value) {
    if (typeof value !== 'string') return value;
    if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value.replace(' ', 'T') + 'Z';
    return value;
}

async function alreadyMigrated(pool) {
    const { rows } = await pool.query('SELECT 1 FROM profiles WHERE tenant_id = $1', [TENANT_ID]);
    return rows.length > 0;
}

async function copyTable(client, sqlite, { sqliteTable, pgTable, columns, boolColumns = [] }) {
    let rows;
    try {
        rows = sqlite.prepare(`SELECT * FROM ${sqliteTable}`).all();
    } catch (err) {
        if (err.message && err.message.includes('no such table')) {
            logger.info(`[Migrate] Source table ${sqliteTable} does not exist — skipping`);
            return 0;
        }
        throw err;
    }

    for (const row of rows) {
        const cols = ['id', 'tenant_id', ...columns];
        const values = [row.id, TENANT_ID, ...columns.map(c => {
            let v = row[c];
            if (boolColumns.includes(c)) v = !!v;
            else v = normalizeTimestamp(v);
            return v;
        })];
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
            `INSERT INTO ${pgTable} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
            values
        );
    }

    if (rows.length > 0) {
        await client.query(
            `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${pgTable}))`,
            [pgTable]
        );
    }

    logger.info(`[Migrate] Copied ${rows.length} row(s): ${sqliteTable} -> ${pgTable}`);
    return rows.length;
}

async function copyReminderNudgeMessages(client, sqlite) {
    let rows;
    try {
        rows = sqlite.prepare('SELECT * FROM reminder_nudge_messages').all();
    } catch (err) {
        if (err.message && err.message.includes('no such table')) return 0;
        throw err;
    }
    for (const row of rows) {
        await client.query(
            `INSERT INTO reminder_nudge_messages (message_id, reminder_id, created_at)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [row.message_id, row.reminder_id, normalizeTimestamp(row.created_at)]
        );
    }
    logger.info(`[Migrate] Copied ${rows.length} row(s): reminder_nudge_messages`);
    return rows.length;
}

// config's PK is (tenant_id, key) — no serial id column, so it can't go through copyTable().
async function copyConfigTable(client, sqlite) {
    let rows;
    try {
        rows = sqlite.prepare('SELECT * FROM config').all();
    } catch (err) {
        if (err.message && err.message.includes('no such table')) return 0;
        throw err;
    }
    for (const row of rows) {
        await client.query(
            `INSERT INTO config (tenant_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [TENANT_ID, row.key, row.value, normalizeTimestamp(row.updated_at)]
        );
    }
    logger.info(`[Migrate] Copied ${rows.length} row(s): config`);
    return rows.length;
}

export async function migrate() {
    const { Pool } = pg;
    const pool = new Pool({ connectionString: process.env.DB_URL });

    // Schema must exist before we can seed data into it.
    await runMigrations(pool);

    if (!fs.existsSync(SQLITE_PATH)) {
        logger.info(`[Migrate] No SQLite file found at ${SQLITE_PATH} — nothing to migrate (fresh install).`);
        await pool.end();
        return;
    }

    if (await alreadyMigrated(pool)) {
        logger.info(`[Migrate] Tenant '${TENANT_ID}' already present in Postgres — skipping (idempotent no-op).`);
        await pool.end();
        return;
    }

    // Copy to a temp file first so we never hold a read-lock against a still-running app.
    const tmpCopyPath = path.join(os.tmpdir(), `noga_migrate_${Date.now()}.db`);
    fs.copyFileSync(SQLITE_PATH, tmpCopyPath);
    const sqlite = new Database(tmpCopyPath, { readonly: true });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO profiles (tenant_id, group_jid, ha_url, ha_token, google_calendar_id, enabled)
             VALUES ($1, $2, $3, $4, $5, TRUE)`,
            [
                TENANT_ID,
                process.env.WHATSAPP_GROUP_ID || null,
                process.env.HOME_ASSISTANT_URL || null,
                process.env.HOME_ASSISTANT_TOKEN || null,
                process.env.CALENDAR_ID || 'primary'
            ]
        );
        logger.info(`[Migrate] Seeded profiles row for tenant '${TENANT_ID}'`);

        const whitelist = parseList(process.env.WHATSAPP_WHITELIST);
        for (const phone of whitelist) {
            await client.query(
                `INSERT INTO whitelists (tenant_id, phone_number) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [TENANT_ID, phone]
            );
        }
        logger.info(`[Migrate] Seeded ${whitelist.length} whitelist entr(y/ies) from WHATSAPP_WHITELIST`);

        await copyConfigTable(client, sqlite);

        await copyTable(client, sqlite, {
            sqliteTable: 'chat_context', pgTable: 'chats',
            columns: ['user_id', 'role', 'content', 'function_call', 'created_at']
        });

        await copyTable(client, sqlite, {
            sqliteTable: 'cache', pgTable: 'cache',
            columns: ['type', 'data', 'status', 'error_message', 'retry_count', 'created_at', 'updated_at']
        });

        await copyTable(client, sqlite, {
            sqliteTable: 'audit_log', pgTable: 'audit_log',
            columns: ['user_id', 'action', 'details', 'created_at']
        });

        await copyTable(client, sqlite, {
            sqliteTable: 'reminders', pgTable: 'reminders',
            columns: [
                'title', 'due_date', 'last_nudged', 'nudge_count', 'nudge_interval_minutes',
                'last_nudge_message_id', 'status', 'created_at', 'updated_at'
            ]
        });

        await copyReminderNudgeMessages(client, sqlite);

        await copyTable(client, sqlite, {
            sqliteTable: 'keywords', pgTable: 'keywords',
            columns: ['keyword', 'response', 'type', 'enabled', 'created_at', 'updated_at'],
            boolColumns: ['enabled']
        });

        await copyTable(client, sqlite, {
            sqliteTable: 'usage_logs', pgTable: 'usage_logs',
            columns: ['timestamp', 'model', 'input_tokens', 'output_tokens', 'total_tokens', 'cost_usd']
        });

        await copyTable(client, sqlite, {
            sqliteTable: 'scheduled_prompts', pgTable: 'scheduled_prompts',
            columns: ['name', 'prompt', 'cron_expression', 'enabled', 'created_at', 'updated_at'],
            boolColumns: ['enabled']
        });

        await copyTable(client, sqlite, {
            sqliteTable: 'ha_mappings', pgTable: 'ha_mappings',
            columns: ['entity_id', 'nickname', 'location', 'type', 'created_at', 'updated_at']
        });

        let pkgVersion = null;
        try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
            pkgVersion = pkg.version;
        } catch { /* non-critical */ }

        await client.query(
            `UPDATE instance SET current_version = $1 WHERE instance_id = 'default'`,
            [pkgVersion]
        );

        await client.query('COMMIT');
        logger.info('[Migrate] Migration committed successfully');
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[Migrate] Migration failed, rolled back', { error: err.message, stack: err.stack });
        throw err;
    } finally {
        client.release();
        sqlite.close();
        fs.unlinkSync(tmpCopyPath);
        await pool.end();
    }
}

// Allow running directly: node scripts/migrate_sqlite_to_postgres.js
if (import.meta.url === `file://${process.argv[1]}`) {
    migrate()
        .then(() => logger.info('[Migrate] Done'))
        .catch((err) => {
            logger.error('[Migrate] Fatal error', { error: err.message });
            process.exit(1);
        });
}
