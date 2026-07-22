import dotenv from 'dotenv';
dotenv.config();

import config, { validateConfig, applyDbOverrides } from './utils/config.js';
import logger from './utils/logger.js';
import db from './database/DatabaseManager.js';
import { getVersionInfo } from './utils/version.js';
import dashboardServer from './dashboard/server.js';

/**
 * Noga admin-portal — Block 5 Phase 1's extracted dashboard process. Owns its own DatabaseManager
 * connection to the shared Postgres (for keywords/reminders/knowledge/tenants/settings) and talks
 * to the orchestrator process only through the internal API (src/internal/server.js) for anything
 * that depends on live in-memory state — see src/dashboard/internalApiClient.js.
 */
async function main() {
    validateConfig();

    try {
        logger.info('Initializing database...');
        await db.init();
        await db.setInstanceVersion(getVersionInfo().version);

        logger.info('Applying DB setting overrides...');
        await applyDbOverrides(db);

        logger.info('Initializing admin-portal server...');
        dashboardServer.init();
        dashboardServer.start();

        logger.info('✨ Admin portal is ready!');
        logger.info(`Dashboard available at http://localhost:${config.dashboard.port}`);
    } catch (err) {
        logger.error('Fatal error during admin-portal startup', { error: err.message, stack: err.stack });
        process.exit(1);
    }
}

async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
        dashboardServer.stop();
        await db.close();

        logger.info('Shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    process.exit(1);
});

main();
