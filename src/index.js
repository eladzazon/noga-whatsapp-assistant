import dotenv from 'dotenv';
dotenv.config();

import config, { validateConfig, applyDbOverrides } from './utils/config.js';
import logger from './utils/logger.js';
import db from './database/DatabaseManager.js';
import tenantContext from './utils/tenantContext.js';
import { getVersionInfo } from './utils/version.js';
import whatsappManager from './bot/WhatsAppManager.js';
import geminiManager from './bot/GeminiManager.js';
import messageRouter from './bot/MessageRouter.js';
import schedulerManager from './bot/SchedulerManager.js';
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

        // One-time self-healing fix (Block 4 Phase 2): backfill profiles.group_jid if a
        // dashboard-set WHATSAPP_GROUP_ID override never made it into the profiles table.
        await db.reconcileDefaultTenantGroupJid(config.tenantId, config.whatsapp.groupId);

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

        // Block 5 Phase 1: the dashboard now runs as its own admin-portal process
        // (src/admin-portal-index.js) and reaches this process only via the internal API below —
        // no more direct in-process wiring (setManagers/setStatusGetters/updateQrCode/etc).
        logger.info('Initializing internal API...');
        internalApiServer.init({ whatsappManager, geminiManager, messageRouter, getSkillsStatus, schedulerManager, homeAssistantManager });
        internalApiServer.start();

        // Initialize WhatsApp client
        logger.info('Initializing WhatsApp...');

        // Ready/disconnected are logged here; admin-portal polls GET /internal/status for
        // connection state and QR code instead of receiving a push (Phase 2's Redis wa:status/
        // wa:qr channels will restore real-time push once WhatsApp is its own container).
        whatsappManager.onReady(() => {
            logger.info('WhatsApp ready - Noga is listening!');
        });

        whatsappManager.onDisconnected((reason) => {
            logger.warn('WhatsApp disconnected', { reason });
        });

        // Initialize WhatsApp (this will show QR code if needed)
        await whatsappManager.init();

        // Initialize message router
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
        // Close WhatsApp client
        await whatsappManager.destroy();

        // Close database
        await db.close();

        // Stop internal API server
        internalApiServer.stop();

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
