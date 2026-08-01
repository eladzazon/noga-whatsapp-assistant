import dotenv from 'dotenv';
dotenv.config();

import config, { validateConfig, applyDbOverrides } from './utils/config.js';
import logger from './utils/logger.js';
import db from './database/DatabaseManager.js';
import { getVersionInfo } from './utils/version.js';
import whatsappManager from './bot/WhatsAppManager.js';
import whatsappConnectorServer from './internal/whatsappConnectorServer.js';
import { CHANNELS, createSubscriber } from './utils/redisClient.js';

/**
 * Noga whatsapp-connector — Block 5 Phase 2's extraction of Baileys into its own process. Owns
 * the WhatsApp session and tenant resolution (profiles.group_jid — see
 * WhatsAppManager._resolveTenant), keeping its own DatabaseManager connection for that. Talks to
 * the orchestrator only via Redis pub/sub (wa:incoming/wa:qr/wa:status, published from inside
 * WhatsAppManager itself) and subscribes to wa:outgoing for outbound sends/media/reactions.
 * Synchronous admin actions (disconnect/reconnect/send-message/send-media) are served directly by
 * whatsappConnectorServer, since pub/sub doesn't fit a "do this and tell me it worked" request.
 */
let outgoingSubscriber = null;

async function main() {
    validateConfig();

    try {
        logger.info('Initializing database...');
        await db.init();
        await db.setInstanceVersion(getVersionInfo().version);

        logger.info('Applying DB setting overrides...');
        await applyDbOverrides(db);

        // One-time self-healing fix (Block 4 Phase 2, moved here in Block 5 Phase 2 since tenant
        // resolution now lives in this process): backfill profiles.group_jid if a dashboard-set
        // WHATSAPP_GROUP_ID override never made it into the profiles table.
        await db.reconcileDefaultTenantGroupJid(config.tenantId, config.whatsapp.groupId);

        logger.info('Initializing whatsapp-connector internal API...');
        whatsappConnectorServer.init({ whatsappManager });
        whatsappConnectorServer.start();

        logger.info('Subscribing to wa:outgoing...');
        outgoingSubscriber = createSubscriber([CHANNELS.OUTGOING], async (channel, payload) => {
            try {
                if (payload.type === 'send') {
                    await whatsappManager.sendMessage(payload.chatId, payload.text);
                } else if (payload.type === 'media') {
                    await whatsappManager.sendMediaMessage(payload.chatId, payload.mediaPath, payload.caption);
                } else if (payload.type === 'react') {
                    await whatsappManager.reactToMessage(payload.key, payload.emoji);
                } else {
                    logger.warn('Unknown wa:outgoing payload type', { type: payload.type });
                }
            } catch (err) {
                logger.error('Failed to process wa:outgoing message', { type: payload.type, error: err.message });
            }
        });

        logger.info('Initializing WhatsApp...');
        await whatsappManager.init();

        logger.info('✨ Whatsapp-connector is ready and listening!');
    } catch (err) {
        logger.error('Fatal error during whatsapp-connector startup', { error: err.message, stack: err.stack });
        process.exit(1);
    }
}

async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
        await whatsappManager.destroy();
        whatsappConnectorServer.stop();
        if (outgoingSubscriber) outgoingSubscriber.disconnect();
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
