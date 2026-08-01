import { CHANNELS, createSubscriber } from '../utils/redisClient.js';
import logger from '../utils/logger.js';

/**
 * Block 5 Phase 2: the orchestrator's local cache of WhatsApp connection state, fed by
 * whatsapp-connector's wa:status/wa:qr publishes. Replaces every direct
 * whatsappManager.isReady/.getStatus() read that used to work because both lived in the same
 * process — MessageRouter's /status command, SchedulerManager's 3 scheduled jobs, and the
 * orchestrator's own internal API's /internal/status all read this instead.
 */
let cached = { isReady: false, hasQrCode: false, qrDataUrl: null };
let subscriber = null;

function init() {
    if (subscriber) return;

    subscriber = createSubscriber([CHANNELS.STATUS, CHANNELS.QR], (channel, payload) => {
        if (channel === CHANNELS.STATUS) {
            cached = payload;
        } else if (channel === CHANNELS.QR) {
            cached = { ...cached, hasQrCode: !!payload.qrDataUrl, qrDataUrl: payload.qrDataUrl };
        }
    });

    logger.info('[waStatusCache] Subscribed to wa:status/wa:qr');
}

function getStatus() {
    return { ...cached };
}

function stop() {
    if (subscriber) {
        subscriber.disconnect();
        subscriber = null;
    }
}

export default { init, getStatus, stop };
