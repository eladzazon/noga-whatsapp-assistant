import dotenv from 'dotenv';
dotenv.config();

import config, { validateConfig } from './utils/config.js';
import logger from './utils/logger.js';
import db from './database/DatabaseManager.js';
import whatsappManager from './bot/WhatsAppManager.js';
import geminiManager from './bot/GeminiManager.js';
import messageRouter from './bot/MessageRouter.js';
import dashboardServer from './dashboard/server.js';
import {
    initializeSkills,
    getSkillsStatus,
    functionDeclarations,
    functionHandlers,
    calendarManager
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
    ║     Powered by Gemini 2.0 Flash       ║
    ║                                       ║
    ╚═══════════════════════════════════════╝
    `);

    // Validate configuration
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
        logger.error('Configuration errors:', { errors: configErrors });
        if (configErrors.some(e => e.includes('required'))) {
            process.exit(1);
        }
    }

    try {
        // Initialize database
        logger.info('Initializing database...');
        db.init();

        // Initialize skills (Google APIs, Home Assistant)
        logger.info('Initializing skills...');
        await initializeSkills();

        // Initialize Gemini AI with function calling
        logger.info('Initializing Gemini AI...');
        geminiManager.init(functionDeclarations, functionHandlers);

        // Initialize dashboard server
        logger.info('Initializing dashboard...');
        dashboardServer.init();

        // Set status getters for dashboard API
        dashboardServer.setStatusGetters(
            () => whatsappManager.getStatus(),
            () => geminiManager.getStatus(),
            () => getSkillsStatus()
        );

        // Start dashboard server
        dashboardServer.start();

        // Initialize WhatsApp client
        logger.info('Initializing WhatsApp...');

        // Set up QR code streaming to dashboard
        whatsappManager.onQrCode((qrDataUrl) => {
            dashboardServer.updateQrCode(qrDataUrl);
        });

        // Set up ready handler
        whatsappManager.onReady(() => {
            dashboardServer.clearQrCode();
            logger.info('WhatsApp ready - Noga is listening!');
        });

        // Set up disconnected handler
        whatsappManager.onDisconnected((reason) => {
            dashboardServer.notifyDisconnected(reason);
        });

        // Initialize WhatsApp (this will show QR code if needed)
        await whatsappManager.init();

        // Initialize message router
        messageRouter.init();

        // Set up birthday check cron job (runs daily at 8 AM Israel time)
        cron.schedule('0 8 * * *', async () => {
            logger.info('Running daily birthday check...');
            try {
                const birthdays = await calendarManager.checkBirthdays();
                if (birthdays.length > 0) {
                    // Log birthdays found
                    logger.info('Birthdays found today', {
                        count: birthdays.length,
                        names: birthdays.map(b => b.title)
                    });

                    // You could extend this to send a WhatsApp notification
                    // to remind about birthdays
                }
            } catch (err) {
                logger.error('Birthday check failed', { error: err.message });
            }
        }, {
            timezone: 'Asia/Jerusalem'
        });

        // Set up database cleanup cron (runs daily at 3 AM)
        cron.schedule('0 3 * * *', () => {
            logger.info('Running database cleanup...');
            const prunedMessages = db.pruneOldMessages(100);
            const cleanedCache = db.cleanOldCache(7);
            logger.info('Database cleanup complete', { prunedMessages, cleanedCache });
        }, {
            timezone: 'Asia/Jerusalem'
        });

        logger.info('✨ Noga is ready and listening!');
        logger.info(`Dashboard available at http://localhost:${config.dashboard.port}`);

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
        db.close();

        // Stop dashboard server
        dashboardServer.stop();

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
});

// Start the application
main();
