import dotenv from 'dotenv';
dotenv.config();

import config, { validateConfig, applyDbOverrides } from './utils/config.js';
import logger from './utils/logger.js';
import db from './database/DatabaseManager.js';
import tenantContext from './utils/tenantContext.js';
import { getVersionInfo } from './utils/version.js';
import geminiManager from './bot/GeminiManager.js';
import messageRouter from './bot/MessageRouter.js';
import schedulerManager from './bot/SchedulerManager.js';
import waStatusCache from './bot/waStatusCache.js';
import internalApiServer from './internal/server.js';
import {
    initializeSkills,
    getSkillsStatus,
    functionDeclarations,
    functionHandlers,
    calendarManager,
    setGeminiManager,
    homeAssistantManager
} from './skills/index.js';
import cron from 'node-cron';

/**
 * Noga - WhatsApp AI Home Assistant
 * Main application entry point
 */
async function main() {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║                                       ║
    ║     🏠 נוגה - Noga Home Assistant    ║
    ║                                       ║
    ║     WhatsApp AI Home Assistant        ║
    ║     Powered by Gemini 2.5 Flash       ║
    ║                                       ║
    ╚═══════════════════════════════════════╝
    `);

    // Validate configuration (throws on critical errors)
    validateConfig();

    try {
        // Initialize database
        logger.info('Initializing database...');
        await db.init();
        await db.setInstanceVersion(getVersionInfo().version);

        // Apply DB-stored setting overrides (from dashboard settings page)
        logger.info('Applying DB setting overrides...');
        await applyDbOverrides(db);

        // Block 5 Phase 2: WhatsApp (and the profiles.group_jid reconciliation that goes with
        // it) now lives entirely in whatsapp-connector — see src/whatsapp-connector-index.js.

        // Initialize skills (Google APIs, Home Assistant)
        logger.info('Initializing skills...');
        await initializeSkills();

        // Initialize Gemini AI with function calling
        logger.info('Initializing Gemini AI...');
        await geminiManager.init(functionDeclarations, functionHandlers);

        // Pass Gemini manager back to skills (for reinit on memory updates)
        setGeminiManager(geminiManager);

        // Initialize Scheduled Prompts
        logger.info('Initializing Scheduler...');
        await schedulerManager.init(geminiManager);

        // Block 5 Phase 2: WhatsApp connection state arrives over wa:status/wa:qr now (published
        // by whatsapp-connector) instead of a direct in-process getStatus() call — waStatusCache
        // subscribes and keeps the latest value for everything that used to read whatsappManager
        // directly (MessageRouter's /status command, SchedulerManager's 3 scheduled jobs, and
        // this process's own internal API below).
        waStatusCache.init();

        // Block 5 Phase 1: the dashboard runs as its own admin-portal process
        // (src/admin-portal-index.js) and reaches this process only via the internal API below —
        // no more direct in-process wiring (setManagers/setStatusGetters/updateQrCode/etc).
        logger.info('Initializing internal API...');
        internalApiServer.init({ geminiManager, messageRouter, getSkillsStatus, schedulerManager, homeAssistantManager });
        internalApiServer.start();

        // Initialize message router — subscribes to wa:incoming (whatsapp-connector is a
        // separate process/container as of Block 5 Phase 2, so messages arrive over Redis).
        messageRouter.init();



        // Set up database cleanup cron (runs daily at 3 AM), once per enabled tenant
        cron.schedule('0 3 * * *', async () => {
            const profiles = await db.getEnabledProfiles();
            for (const profile of profiles) {
                await tenantContext.run(profile.tenant_id, async () => {
                    const tenantId = tenantContext.getTenantId();
                    logger.info('Running database cleanup...', { tenantId });
                    const prunedMessages = await db.pruneOldMessages(tenantId, 100);
                    const cleanedCache = await db.cleanOldCache(tenantId, 7);
                    const prunedReminders = await db.pruneExpiredReminders(tenantId, 1);
                    logger.info('Database cleanup complete', { tenantId, prunedMessages, cleanedCache, prunedReminders });
                });
            }
        }, {
            timezone: 'Asia/Jerusalem'
        });

        logger.info('✨ Noga is ready and listening!');
        logger.info(`Internal API available at http://localhost:${config.internal.port}`);

    } catch (err) {
        logger.error('Fatal error during startup', { error: err.message, stack: err.stack });
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
        // Close database
        await db.close();

        // Stop internal API server
        internalApiServer.stop();

        waStatusCache.stop();
        if (messageRouter.incomingSubscriber) messageRouter.incomingSubscriber.disconnect();

        logger.info('Shutdown complete');
        process.exit(0);
    } catch (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
    }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
    process.exit(1);
});

// Start the application
main();
