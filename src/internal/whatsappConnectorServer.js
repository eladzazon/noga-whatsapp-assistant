import express from 'express';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Block 5 Phase 2: whatsapp-connector's own internal API. Structurally identical to
 * src/internal/server.js (the orchestrator's), but exists because these 4 actions
 * (disconnect/reconnect/send-message/send-media) are synchronous request/response admin actions
 * that don't fit wa:outgoing's fire-and-forget pub/sub — admin-portal calls this directly instead
 * of relaying through the orchestrator. Protected the same way: x-internal-secret header, same
 * Docker-network-only exposure, unauthenticated /health for Docker's own healthcheck.
 */
class WhatsappConnectorServer {
    constructor() {
        this.app = null;
        this.server = null;
        this.whatsappManager = null;
    }

    /**
     * @param {Object} deps
     * @param {Object} deps.whatsappManager
     */
    init(deps) {
        this.whatsappManager = deps.whatsappManager;

        this.app = express();
        this.app.use(express.json({ limit: '10mb' }));

        this.app.get('/health', (req, res) => res.json({ status: 'ok' }));

        this.app.use((req, res, next) => {
            const secret = req.headers['x-internal-secret'];
            if (!secret || secret !== config.whatsappConnector.secret) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        });

        this._setupRoutes();
        return this;
    }

    _setupRoutes() {
        const app = this.app;

        app.get('/internal/status', (req, res, next) => {
            try {
                res.json(this.whatsappManager.getStatus());
            } catch (err) { next(err); }
        });

        app.post('/internal/disconnect', async (req, res, next) => {
            try {
                await this.whatsappManager.logout();
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.post('/internal/reconnect', async (req, res, next) => {
            try {
                await this.whatsappManager.reconnect();
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.post('/internal/send-message', async (req, res, next) => {
            try {
                const { chatId, text } = req.body;
                const messageId = await this.whatsappManager.sendMessage(chatId, text);
                res.json({ success: true, messageId });
            } catch (err) { next(err); }
        });

        // mediaPath must point at a location on the volume shared between admin-portal and
        // this container (both mount data/temp) — same shared temp-file approach as Phase 1.
        app.post('/internal/send-media', async (req, res, next) => {
            try {
                const { chatId, mediaPath, caption } = req.body;
                await this.whatsappManager.sendMediaMessage(chatId, mediaPath, caption);
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.use((err, req, res, next) => {
            logger.error('[WhatsappConnectorAPI] Request failed', { path: req.path, error: err.message });
            res.status(500).json({ error: err.message });
        });
    }

    start() {
        this.server = this.app.listen(config.whatsappConnector.port, () => {
            logger.info(`Whatsapp-connector internal API listening on port ${config.whatsappConnector.port}`);
        });
        return this;
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}

export default new WhatsappConnectorServer();
