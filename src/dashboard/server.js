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
        this.geminiManager = null;
        this.db = null;
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
                skills: this.getSkillsStatus ? this.getSkillsStatus() : {},
                usage: this.db ? this.db.getUsageStats() : { today: {}, month: {} }
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

        // ==================== System Prompt API ====================

        // Get current system prompt
        this.app.get('/api/system-prompt', requireAuth, (req, res) => {
            if (!this.geminiManager) {
                return res.status(500).json({ error: 'Gemini not initialized' });
            }
            res.json({ prompt: this.geminiManager.getSystemPrompt() });
        });

        // Update system prompt
        this.app.put('/api/system-prompt', requireAuth, (req, res) => {
            const { prompt } = req.body;
            if (!prompt || !prompt.trim()) {
                return res.status(400).json({ error: 'Prompt is required' });
            }
            if (!this.geminiManager) {
                return res.status(500).json({ error: 'Gemini not initialized' });
            }
            try {
                this.geminiManager.reinit(prompt.trim());
                logger.info('System prompt updated via dashboard');
                res.json({ success: true });
            } catch (err) {
                logger.error('Failed to update system prompt', { error: err.message });
                res.status(500).json({ error: err.message });
            }
        });

        // ==================== Keywords API ====================

        // Get all keywords
        this.app.get('/api/keywords', requireAuth, (req, res) => {
            if (!this.db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const keywords = this.db.getKeywords();
                res.json({ keywords });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Add keyword
        this.app.post('/api/keywords', requireAuth, (req, res) => {
            const { keyword, response, type } = req.body;
            if (!keyword || !response) {
                return res.status(400).json({ error: 'keyword and response are required' });
            }
            if (!this.db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const id = this.db.addKeyword(keyword, response, type || 'static');
                logger.info('Keyword added via dashboard', { keyword, type: type || 'static' });
                res.json({ success: true, id });
            } catch (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Keyword already exists' });
                }
                res.status(500).json({ error: err.message });
            }
        });

        // Update keyword
        this.app.put('/api/keywords/:id', requireAuth, (req, res) => {
            const { id } = req.params;
            const { keyword, response, enabled, type } = req.body;
            if (!keyword || !response) {
                return res.status(400).json({ error: 'keyword and response are required' });
            }
            if (!this.db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                this.db.updateKeyword(parseInt(id), keyword, response, enabled !== false, type || 'static');
                logger.info('Keyword updated via dashboard', { id, keyword, type: type || 'static' });
                res.json({ success: true });
            } catch (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Keyword already exists' });
                }
                res.status(500).json({ error: err.message });
            }
        });

        // Delete keyword
        this.app.delete('/api/keywords/:id', requireAuth, (req, res) => {
            const { id } = req.params;
            if (!this.db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                this.db.deleteKeyword(parseInt(id));
                logger.info('Keyword deleted via dashboard', { id });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
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
     * Set manager references for API routes
     */
    setManagers(geminiManager, db) {
        this.geminiManager = geminiManager;
        this.db = db;
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
