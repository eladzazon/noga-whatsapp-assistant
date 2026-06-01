import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import compression from 'compression';
import config from '../utils/config.js';
import logger, { subscribeToLogs, getRecentLogs } from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import multer from 'multer';

// Import newly separated routes and socket handler
import { requireAuth } from './routes/auth.js';
import createAuthRoutes from './routes/auth.js';
import createStatusRoutes from './routes/status.js';
import createWhatsappRoutes from './routes/whatsapp.js';
import createKnowledgeRoutes from './routes/knowledge.js';
import createKeywordsRoutes from './routes/keywords.js';
import createRemindersRoutes from './routes/reminders.js';
import createSettingsRoutes from './routes/settings.js';
import createBackupRoutes from './routes/backup.js';
import createHaRoutes from './routes/ha.js';
import setupSocketIO from './socket.js';
import { errorHandler } from './middleware/error.js';

// Pre-load singletons once at module level to avoid dynamic import overhead
const whatsappManagerPromise = import('../bot/WhatsAppManager.js').then(m => m.default);
const schedulerManagerPromise = import('../bot/SchedulerManager.js').then(m => m.default);
const skillsIndexPromise = import('../skills/index.js');

const FileStore = sessionFileStore(session);

const uploadDir = path.resolve(process.cwd(), 'data', 'temp');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DashboardServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.io = null;
        this.qrCode = null;
        this.geminiManager = null;
        this.messageRouter = null;
    }

    /**
     * Initialize the dashboard server
     */
    init() {
        // Create HTTP server
        this.server = createServer(this.app);

        // Create Socket.IO server
        this.io = new SocketIOServer(this.server);

        // Configure middleware
        this._setupMiddleware();

        // Configure routes
        this._setupRoutes();

        // Configure Socket.IO
        setupSocketIO(this.io, {
            logger,
            server: this,
            subscribeToLogs,
            getRecentLogs
        });

        logger.info('Dashboard server initialized');
        return this;
    }

    /**
     * Set up Express middleware
     */
    _setupMiddleware() {
        // Parse JSON and URL-encoded bodies
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));

        // Gzip/Brotli compression for all responses
        this.app.use(compression());

        // Session management
        this.app.use(session({
            store: new FileStore({
                path: path.resolve(process.cwd(), 'data', 'sessions'),
                retries: 2,
                logFn: () => {} // Suppress retry logs
            }),
            secret: config.dashboard.sessionSecret,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: false, // Set to true if using HTTPS
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            }
        }));

        // Serve static files
        this.app.use('/public', express.static(path.join(__dirname, 'public')));
        
        // Serve PWA assets at root to ensure proper Service Worker scope
        this.app.get('/sw.js', (req, res) => {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.sendFile(path.join(__dirname, 'public', 'sw.js'));
        });
        this.app.get('/manifest.json', (req, res) => {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
        });

        // Set view engine
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, 'views'));
    }

    /**
     * Set up routes
     */
    _setupRoutes() {
        const deps = {
            requireAuth, db, config, logger,
            whatsappManagerPromise, schedulerManagerPromise, skillsIndexPromise,
            upload, server: this, getRecentLogs
        };
        
        this.app.use(createAuthRoutes(deps));
        this.app.use(createStatusRoutes(deps));
        this.app.use(createWhatsappRoutes(deps));
        this.app.use(createKnowledgeRoutes(deps));
        this.app.use(createKeywordsRoutes(deps));
        this.app.use(createRemindersRoutes(deps));
        this.app.use(createSettingsRoutes(deps));
        this.app.use(createBackupRoutes(deps));
        this.app.use(createHaRoutes(deps));

        // Centralized error handling middleware
        this.app.use(errorHandler);
    }

    /**
     * Update QR code and broadcast to clients
     */
    updateQrCode(qrDataUrl) {
        this.qrCode = qrDataUrl;
        if (this.io) {
            this.io.emit('qr', qrDataUrl);
        }
    }

    /**
     * Clear QR code (when connected)
     */
    clearQrCode() {
        this.qrCode = null;
        if (this.io) {
            this.io.emit('qr', null);
            this.io.emit('connected');
        }
    }

    /**
     * Broadcast WhatsApp disconnection
     */
    notifyDisconnected(reason) {
        if (this.io) {
            this.io.emit('disconnected', reason);
        }
    }

    /**
     * Set status getters
     */
    setStatusGetters(whatsapp, gemini, skills) {
        this.getWhatsAppStatus = whatsapp;
        this.getGeminiStatus = gemini;
        this.getSkillsStatus = skills;
    }

    /**
     * Set config update handler
     */
    setConfigUpdateHandler(handler) {
        this.onConfigUpdate = handler;
    }

    /**
     * Set manager references for API routes
     */
    setManagers(geminiManager, dbInstance, messageRouter) {
        this.geminiManager = geminiManager;
        this.db = dbInstance;
        this.messageRouter = messageRouter;
    }

    /**
     * Start the server
     */
    start() {
        const port = config.dashboard.port;
        this.server.listen(port, () => {
            logger.info(`Dashboard server running on port ${port}`);
        });
    }

    /**
     * Stop the server
     */
    stop() {
        if (this.server) {
            this.server.close();
        }
    }
}

export default new DashboardServer();
export { DashboardServer };
