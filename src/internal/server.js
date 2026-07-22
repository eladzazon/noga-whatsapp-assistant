import express from 'express';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import tenantContext from '../utils/tenantContext.js';

/**
 * Block 5 Phase 1: the internal API the admin-portal process calls for everything that depends
 * on the orchestrator's live in-memory state — WhatsApp/Gemini status, the dashboard chat
 * feature, reinit-on-file-edit, and WhatsApp send/disconnect/reconnect (still needed here since
 * WhatsApp itself doesn't move out until Phase 2). Not exposed publicly: same Docker network
 * only, plus the shared-secret check below (same pattern as the existing HA webhook secret,
 * deliberately a separate secret so the two auth surfaces don't get conflated).
 *
 * Deliberately not proxying pure-DB operations here (keywords, reminders, knowledge files,
 * tenant approval, etc.) — admin-portal keeps its own DatabaseManager connection to the same
 * Postgres for those, per the Block 5 plan.
 */
class InternalApiServer {
    constructor() {
        this.app = null;
        this.server = null;
        this.whatsappManager = null;
        this.geminiManager = null;
        this.messageRouter = null;
        this.getSkillsStatus = null;
        this.schedulerManager = null;
        this.homeAssistantManager = null;
    }

    /**
     * @param {Object} deps
     * @param {Object} deps.whatsappManager
     * @param {Object} deps.geminiManager
     * @param {Object} deps.messageRouter
     * @param {Function} deps.getSkillsStatus
     * @param {Object} deps.schedulerManager
     * @param {Object} deps.homeAssistantManager
     */
    init(deps) {
        this.whatsappManager = deps.whatsappManager;
        this.geminiManager = deps.geminiManager;
        this.messageRouter = deps.messageRouter;
        this.getSkillsStatus = deps.getSkillsStatus;
        this.schedulerManager = deps.schedulerManager;
        this.homeAssistantManager = deps.homeAssistantManager;

        this.app = express();
        this.app.use(express.json({ limit: '10mb' }));

        // Unauthenticated — this is what the orchestrator container's Docker HEALTHCHECK hits
        // now that it no longer serves the dashboard on this port.
        this.app.get('/health', (req, res) => res.json({ status: 'ok' }));

        this.app.use((req, res, next) => {
            const secret = req.headers['x-internal-secret'];
            if (!secret || secret !== config.internal.secret) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            next();
        });

        this._setupRoutes();
        return this;
    }

    _setupRoutes() {
        const app = this.app;

        app.get('/internal/status', async (req, res, next) => {
            try {
                res.json({
                    whatsapp: this.whatsappManager.getStatus(),
                    gemini: this.geminiManager.getStatus(),
                    skills: await this.getSkillsStatus()
                });
            } catch (err) { next(err); }
        });

        app.post('/internal/reinit', async (req, res, next) => {
            try {
                await this.geminiManager.reinit();
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        // tenantId is optional — admin-portal doesn't yet share its session's selected tenant
        // over Socket.IO (same gap Block 4 Phase 2 already noted for this exact feature), so
        // this falls back to config.tenantId via tenantContext, matching today's behavior.
        app.post('/internal/chat', async (req, res, next) => {
            try {
                const { text, tenantId } = req.body;
                const response = await tenantContext.run(tenantId || config.tenantId, () =>
                    this.messageRouter.processText('dashboard_admin', text)
                );
                res.json({ text: response });
            } catch (err) { next(err); }
        });

        app.post('/internal/clear-chat', async (req, res, next) => {
            try {
                const { tenantId } = req.body;
                await tenantContext.run(tenantId || config.tenantId, () =>
                    this.geminiManager.clearHistory('dashboard_admin')
                );
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.post('/internal/broadcast', async (req, res, next) => {
            try {
                const message = await this.geminiManager.generateBroadcastMessage(req.body);
                res.json({ message });
            } catch (err) { next(err); }
        });

        app.post('/internal/reload-schedules', async (req, res, next) => {
            try {
                await this.schedulerManager.reload();
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        // tenantId optional for the same reason as /internal/chat above — falls back to
        // config.tenantId until admin-portal has a tenant-switcher UI (Block 4 Phase 2 gap).
        app.get('/internal/ha/entities', async (req, res, next) => {
            try {
                const tenantId = req.query.tenantId;
                const result = await tenantContext.run(tenantId || config.tenantId, async () => {
                    const ha = await this.homeAssistantManager.getCurrent();
                    return ha.getEntities();
                });
                res.json(result);
            } catch (err) { next(err); }
        });

        app.post('/internal/whatsapp/disconnect', async (req, res, next) => {
            try {
                await this.whatsappManager.logout();
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.post('/internal/whatsapp/reconnect', async (req, res, next) => {
            try {
                await this.whatsappManager.reconnect();
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.post('/internal/whatsapp/send-message', async (req, res, next) => {
            try {
                const { chatId, text } = req.body;
                const messageId = await this.whatsappManager.sendMessage(chatId, text);
                res.json({ success: true, messageId });
            } catch (err) { next(err); }
        });

        // mediaPath must point at a location on the volume shared between admin-portal and
        // this process (both mount data/temp) — see docker-compose.yml.
        app.post('/internal/whatsapp/send-media', async (req, res, next) => {
            try {
                const { chatId, mediaPath, caption } = req.body;
                await this.whatsappManager.sendMediaMessage(chatId, mediaPath, caption);
                res.json({ success: true });
            } catch (err) { next(err); }
        });

        app.use((err, req, res, next) => {
            logger.error('[InternalAPI] Request failed', { path: req.path, error: err.message });
            res.status(500).json({ error: err.message });
        });
    }

    start() {
        this.server = this.app.listen(config.internal.port, () => {
            logger.info(`Internal API listening on port ${config.internal.port}`);
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

export default new InternalApiServer();
