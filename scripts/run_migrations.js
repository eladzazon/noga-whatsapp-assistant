import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import logger from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'database', 'migrations');

async function getAppliedVersion(pool) {
    const { rows } = await pool.query(`SELECT to_regclass('public.instance') AS reg`);
    if (!rows[0].reg) return 0; // instance table doesn't exist yet — nothing applied
    const { rows: verRows } = await pool.query(
        `SELECT schema_version FROM instance WHERE instance_id = 'default'`
    );
    return verRows[0]?.schema_version ?? 0;
}

/**
 * Applies any migrations/*.sql files numbered above the current instance.schema_version.
 * Idempotent — safe to call on every app startup.
 */
export async function runMigrations(pool) {
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => /^\d+_.*\.sql$/.test(f))
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    const currentVersion = await getAppliedVersion(pool);

    for (const file of files) {
        const version = parseInt(file.split('_')[0], 10);
        if (version <= currentVersion) continue;

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
        logger.info(`[Migrations] Applying ${file}...`);
        await pool.query(sql);

        // 001_init.sql seeds instance.schema_version itself (chicken-and-egg: the table
        // doesn't exist before it runs). Later migration files must bump it explicitly.
        if (version > 1) {
            await pool.query(
                `UPDATE instance SET schema_version = $1 WHERE instance_id = 'default'`,
                [version]
            );
        }
        logger.info(`[Migrations] Applied ${file}`);
    }
}

// Allow running directly: node scripts/run_migrations.js
if (import.meta.url === `file://${process.argv[1]}`) {
    const { Pool } = pg;
    const pool = new Pool({ connectionString: process.env.DB_URL });
    runMigrations(pool)
        .then(async () => {
            logger.info('[Migrations] Schema up to date');
            await pool.end();
        })
        .catch(async (err) => {
            logger.error('[Migrations] Failed', { error: err.message });
            await pool.end();
            process.exit(1);
        });
}
