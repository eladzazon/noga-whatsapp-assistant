import Redis from 'ioredis';
import config from './config.js';
import logger from './logger.js';

/**
 * Block 5 Phase 2: pub/sub transport between whatsapp-connector and the orchestrator, replacing
 * the in-process callback wiring WhatsAppManager used before the process split.
 */
export const CHANNELS = {
    INCOMING: 'wa:incoming',
    OUTGOING: 'wa:outgoing',
    QR: 'wa:qr',
    STATUS: 'wa:status'
};

let publisher = null;

function getPublisher() {
    if (!publisher) {
        publisher = new Redis(config.redis.url);
        publisher.on('error', (err) => logger.error('[Redis] Publisher connection error', { error: err.message }));
    }
    return publisher;
}

export async function publish(channel, payload) {
    await getPublisher().publish(channel, JSON.stringify(payload));
}

/**
 * Opens a dedicated subscriber connection (ioredis can't issue other commands on a connection
 * once it's in subscribe mode) and dispatches parsed JSON payloads to onMessage(channel, payload).
 * Malformed payloads are logged and dropped rather than crashing the subscriber.
 */
export function createSubscriber(channels, onMessage) {
    const sub = new Redis(config.redis.url);
    sub.on('error', (err) => logger.error('[Redis] Subscriber connection error', { error: err.message }));

    sub.subscribe(...channels, (err) => {
        if (err) {
            logger.error('[Redis] Failed to subscribe', { channels, error: err.message });
        } else {
            logger.info('[Redis] Subscribed', { channels });
        }
    });

    sub.on('message', (channel, message) => {
        let payload;
        try {
            payload = JSON.parse(message);
        } catch (err) {
            logger.error('[Redis] Failed to parse message, dropping', { channel, error: err.message });
            return;
        }
        onMessage(channel, payload);
    });

    return sub;
}

export default { CHANNELS, publish, createSubscriber };
