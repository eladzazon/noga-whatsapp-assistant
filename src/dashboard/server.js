import express from 'express';
import session from 'express-session';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../utils/config.js';
import logger, { subscribeToLogs, getRecentLogs } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DashboardServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.io = null;
        this.qrCode = null;
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
        this._setupSocketIO();

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

        // Session management
        this.app.use(session({
            secret: config.dashboard.sessionSecret,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: false, // Set to true if using HTTPS
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            }
        }));

        // Serve static files
        this.app.use('/public', express.static(path.join(__dirname, 'public')));

        // Set view engine
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, 'views'));

        // Logging middleware
        this.app.use((req, res, next) => {
            logger.debug('HTTP Request', {
                method: req.method,
                path: req.path
            });
            next();
        });
    }

    /**
     * Set up routes
     */
    _setupRoutes() {
        // Auth middleware
        const requireAuth = (req, res, next) => {
            if (req.session && req.session.authenticated) {
                return next();
            }
            res.redirect('/');
        };

        // Login page
        this.app.get('/', (req, res) => {
            if (req.session && req.session.authenticated) {
                return res.redirect('/dashboard');
            }
            res.render('login', { error: null });
        });

        // Login handler
        this.app.post('/login', (req, res) => {
            const { username, password } = req.body;

            if (username === config.dashboard.user &&
                password === config.dashboard.password) {
                req.session.authenticated = true;
                logger.info('Dashboard login successful');
                return res.redirect('/dashboard');
            }

            logger.warn('Dashboard login failed', { username });
            res.render('login', { error: 'Invalid credentials' });
        });

        // Logout
        this.app.get('/logout', (req, res) => {
            req.session.destroy();
            res.redirect('/');
        });

        // Dashboard page
        this.app.get('/dashboard', requireAuth, (req, res) => {
            res.render('dashboard', {
                qrCode: this.qrCode,
                recentLogs: getRecentLogs(50)
            });
        });

        // API: Get status
        this.app.get('/api/status', requireAuth, (req, res) => {
            res.json({
                whatsapp: this.getWhatsAppStatus ? this.getWhatsAppStatus() : { isReady: false },
                gemini: this.getGeminiStatus ? this.getGeminiStatus() : { isInitialized: false },
                skills: this.getSkillsStatus ? this.getSkillsStatus() : {}
            });
        });

        // API: Update config
        this.app.post('/api/config', requireAuth, (req, res) => {
            const { key, value } = req.body;

            if (this.onConfigUpdate) {
                this.onConfigUpdate(key, value);
            }

            res.json({ success: true });
        });

        // API: Get logs
        this.app.get('/api/logs', requireAuth, (req, res) => {
            const count = parseInt(req.query.count) || 50;
            res.json(getRecentLogs(count));
        });

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
    }

    /**
     * Set up Socket.IO
     */
    _setupSocketIO() {
        // Authentication middleware for Socket.IO
        this.io.use((socket, next) => {
            // In production, you'd verify the session here
            next();
        });

        this.io.on('connection', (socket) => {
            logger.debug('Dashboard client connected', { id: socket.id });

            // Send current QR code if available
            if (this.qrCode) {
                socket.emit('qr', this.qrCode);
            }

            // Send recent logs
            socket.emit('logs', getRecentLogs(50));

            socket.on('disconnect', () => {
                logger.debug('Dashboard client disconnected', { id: socket.id });
            });
        });

        // Subscribe to log events and broadcast
        subscribeToLogs((logEntry) => {
            this.io.emit('log', logEntry);
        });
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
