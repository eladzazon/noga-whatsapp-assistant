import express from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from '../utils/config.js';
import logger, { subscribeToLogs, getRecentLogs } from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import multer from 'multer';

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
            store: new FileStore({
                path: path.resolve(process.cwd(), 'data', 'sessions'),
                retries: 0
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

        // Set view engine
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, 'views'));


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
                usage: db ? db.getUsageStats() : { today: {}, month: {} }
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

        // Restart application (Docker will auto-restart via restart: unless-stopped)
        this.app.post('/api/restart', requireAuth, (req, res) => {
            logger.warn('Application restart requested from dashboard');
            res.json({ success: true, message: 'Restarting application...' });
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        });

        // Get server log file contents
        this.app.get('/api/logs/file', requireAuth, (req, res) => {
            const lines = Math.min(parseInt(req.query.lines) || 500, 2000);
            const logPath = path.resolve(process.cwd(), 'data', 'logs', 'combined.log');

            try {
                if (!fs.existsSync(logPath)) {
                    return res.json({ logs: [], message: 'Log file not found. File logging is only available in production mode.' });
                }

                const content = fs.readFileSync(logPath, 'utf-8');
                const allLines = content.trim().split('\n').filter(Boolean);
                const recentLines = allLines.slice(-lines);

                const parsedLogs = recentLines.map(line => {
                    try {
                        return JSON.parse(line);
                    } catch {
                        return { timestamp: '', level: 'info', message: line };
                    }
                });

                res.json({ logs: parsedLogs, total: allLines.length, showing: recentLines.length });
            } catch (err) {
                logger.error('Failed to read log file', { error: err.message });
                res.status(500).json({ error: 'Failed to read log file' });
            }
        });

        // WhatsApp Disconnect
        this.app.post('/api/whatsapp/disconnect', requireAuth, async (req, res) => {
            try {
                const { default: whatsappManager } = await import('../bot/WhatsAppManager.js');
                await whatsappManager.logout();
                res.json({ success: true, message: 'WhatsApp disconnected successfully. Scan new QR code.' });
            } catch (err) {
                logger.error('Failed to disconnect WhatsApp', { error: err.message });
                res.status(500).json({ error: 'Failed to disconnect WhatsApp' });
            }
        });

        // WhatsApp Reconnect (manual - used after 405 errors)
        this.app.post('/api/whatsapp/reconnect', requireAuth, async (req, res) => {
            try {
                const { default: whatsappManager } = await import('../bot/WhatsAppManager.js');
                await whatsappManager.reconnect();
                res.json({ success: true, message: 'Reconnecting WhatsApp. Please wait for QR code...' });
            } catch (err) {
                logger.error('Failed to reconnect WhatsApp', { error: err.message });
                res.status(500).json({ error: 'Failed to reconnect WhatsApp' });
            }
        });

        // ==================== Webhook API ====================

        // Status webhook (for Home Assistant)
        this.app.get('/api/webhook/status', (req, res) => {
            const secret = req.headers['x-webhook-secret'] || req.query.secret;

            // Verify Secret
            if (!config.dashboard.webhookSecret || secret !== config.dashboard.webhookSecret) {
                logger.warn('Unauthorized status webhook attempt', { ip: req.ip });
                return res.status(401).json({ error: 'Unauthorized' });
            }

            res.json({
                whatsapp: this.getWhatsAppStatus ? this.getWhatsAppStatus() : { isReady: false },
                gemini: this.getGeminiStatus ? this.getGeminiStatus() : { isInitialized: false },
                skills: this.getSkillsStatus ? this.getSkillsStatus() : {},
                usage: db ? db.getUsageStats() : { today: {}, month: {} }
            });
        });

        // Notification webhook (for Home Assistant)
        // Accepts application/json OR multipart/form-data (for image uploads)
        this.app.post('/api/notify', upload.single('image'), async (req, res) => {
            const event = req.body.event;
            let data = {};
            if (req.body.data) {
                try {
                    data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
                } catch (e) {
                    logger.warn('Failed to parse webhook data', { error: e.message });
                }
            }
            
            const secret = req.headers['x-webhook-secret'] || req.query.secret || req.body.secret;

            // 1. Verify Secret
            if (!config.dashboard.webhookSecret || secret !== config.dashboard.webhookSecret) {
                logger.warn('Unauthorized webhook attempt', { ip: req.ip });
                return res.status(401).json({ error: 'Unauthorized' });
            }

            // 2. Validate Data
            if (!event) {
                return res.status(400).json({ error: 'Event name required' });
            }

            // 3. Process Webhook
            logger.info('Webhook received', { event });

            try {
                // Generate message: Use raw event text for images, or AI for text-only broadcasts
                const message = req.file ? event : await this.geminiManager.generateBroadcastMessage({ event, ...data });

                // Send to WhatsApp Group
                if (config.whatsapp.groupId) {
                    const whatsappStatus = this.getWhatsAppStatus ? this.getWhatsAppStatus() : { isReady: false };

                    if (whatsappStatus.isReady) {
                        const { default: whatsappManager } = await import('../bot/WhatsAppManager.js');
                        
                        let messageSent = false;
                        
                        // If an image was uploaded, send it as media
                        if (req.file) {
                            try {
                                // Provide a default extension if missing so WhatsApp knows it's an image
                                const fileExt = path.extname(req.file.originalname) || '.jpg';
                                const tempPath = req.file.path;
                                const mediaPath = tempPath + fileExt;
                                fs.renameSync(tempPath, mediaPath);
                                
                                await whatsappManager.sendMediaMessage(config.whatsapp.groupId, mediaPath, message);
                                
                                // Log to history
                                if (this.db) {
                                    this.db.addChatMessage(config.whatsapp.groupId, 'model', `[Image Notification] ${message}`);
                                }

                                // Clean up
                                fs.unlinkSync(mediaPath);
                                messageSent = true;
                            } catch (uploadErr) {
                                logger.error('Failed to send media message', { error: uploadErr.message });
                                // Fallback to text
                            }
                        }
                        
                        // Send as text if no image or image failed
                        if (!messageSent) {
                            await whatsappManager.sendMessage(config.whatsapp.groupId, message);
                            // Log to history
                            if (this.db) {
                                this.db.addChatMessage(config.whatsapp.groupId, 'model', message);
                            }
                        }
                        
                        return res.json({ success: true, message, hasImage: !!req.file });
                    } else {
                        // Clean up file if WA not ready
                        if (req.file) fs.unlinkSync(req.file.path);
                        return res.status(503).json({ error: 'WhatsApp client not ready' });
                    }
                } else {
                    if (req.file) fs.unlinkSync(req.file.path);
                    return res.status(400).json({ error: 'WHATSAPP_GROUP_ID not configured' });
                }

            } catch (err) {
                if (req.file) {
                    try { fs.unlinkSync(req.file.path); } catch(e){}
                }
                logger.error('Webhook processing error', { error: err.message, stack: err.stack });
                return res.status(500).json({ error: 'Internal server error', details: err.message });
            }
        });

        // ==================== Knowledge Base API ====================

        // Get all knowledge files
        this.app.get('/api/knowledge', requireAuth, (req, res) => {
            try {
                const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
                if (!fs.existsSync(knowledgeDir)) {
                    return res.json({ files: [] });
                }
                const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md')).map(f => {
                    const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf-8');
                    return { name: f, content };
                });
                res.json({ files });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Save knowledge file
        this.app.put('/api/knowledge/:filename', requireAuth, (req, res) => {
            const { filename } = req.params;
            const { content } = req.body;
            if (!content && content !== '') {
                return res.status(400).json({ error: 'Content is required' });
            }
            try {
                const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
                if (!fs.existsSync(knowledgeDir)) {
                    fs.mkdirSync(knowledgeDir, { recursive: true });
                }
                fs.writeFileSync(path.join(knowledgeDir, filename), content, 'utf-8');
                
                // Re-initialize Gemini model
                if (this.geminiManager) {
                    this.geminiManager.reinit();
                }
                
                logger.info('Knowledge file updated via dashboard', { filename });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Delete knowledge file
        this.app.delete('/api/knowledge/:filename', requireAuth, (req, res) => {
            const { filename } = req.params;
            try {
                const filePath = path.resolve(process.cwd(), 'data', 'knowledge', filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                
                // Re-initialize Gemini model
                if (this.geminiManager) {
                    this.geminiManager.reinit();
                }
                
                logger.info('Knowledge file deleted via dashboard', { filename });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ==================== Skills Library API ====================

        // Get all skill files
        this.app.get('/api/skills', requireAuth, (req, res) => {
            try {
                const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
                if (!fs.existsSync(skillsDir)) {
                    return res.json({ files: [] });
                }
                const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).map(f => {
                    const content = fs.readFileSync(path.join(skillsDir, f), 'utf-8');
                    return { name: f, content };
                });
                res.json({ files });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Save skill file
        this.app.put('/api/skills/:filename', requireAuth, (req, res) => {
            const { filename } = req.params;
            const { content } = req.body;
            if (!content && content !== '') {
                return res.status(400).json({ error: 'Content is required' });
            }
            try {
                const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
                if (!fs.existsSync(skillsDir)) {
                    fs.mkdirSync(skillsDir, { recursive: true });
                }
                fs.writeFileSync(path.join(skillsDir, filename), content, 'utf-8');
                
                // Re-initialize Gemini model
                if (this.geminiManager) {
                    this.geminiManager.reinit();
                }
                
                logger.info('Skill file updated via dashboard', { filename });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Delete skill file
        this.app.delete('/api/skills/:filename', requireAuth, (req, res) => {
            const { filename } = req.params;
            try {
                const filePath = path.resolve(process.cwd(), 'data', 'skills', filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                
                // Re-initialize Gemini model
                if (this.geminiManager) {
                    this.geminiManager.reinit();
                }
                
                logger.info('Skill file deleted via dashboard', { filename });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ==================== Keywords API ====================

        // Get all keywords
        this.app.get('/api/keywords', requireAuth, (req, res) => {
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const keywords = db.getKeywords();
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
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const id = db.addKeyword(keyword, response, type || 'static');
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
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.updateKeyword(parseInt(id), keyword, response, enabled !== false, type || 'static');
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
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.deleteKeyword(parseInt(id));
                logger.info('Keyword deleted via dashboard', { id });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ==================== Scheduled Prompts API ====================

        // Get all scheduled prompts
        this.app.get('/api/scheduled-prompts', requireAuth, (req, res) => {
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const prompts = db.getScheduledPrompts();
                res.json({ prompts });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Add scheduled prompt
        this.app.post('/api/scheduled-prompts', requireAuth, async (req, res) => {
            const { name, prompt, cronExpression, enabled } = req.body;
            if (!name || !prompt || !cronExpression) {
                return res.status(400).json({ error: 'Name, prompt, and cron expression are required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });

            try {
                const id = db.addScheduledPrompt(name, prompt, cronExpression, enabled);
                logger.info('Scheduled prompt added via dashboard', { name });

                // Reload scheduling engine
                const { default: schedulerManager } = await import('../bot/SchedulerManager.js');
                schedulerManager.reload();

                res.json({ success: true, id });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Update scheduled prompt
        this.app.put('/api/scheduled-prompts/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            const { name, prompt, cronExpression, enabled } = req.body;
            if (!name || !prompt || !cronExpression) {
                return res.status(400).json({ error: 'Name, prompt, and cron expression are required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });

            try {
                db.updateScheduledPrompt(parseInt(id), name, prompt, cronExpression, enabled);
                logger.info('Scheduled prompt updated via dashboard', { id, name });

                // Reload scheduling engine
                const { default: schedulerManager } = await import('../bot/SchedulerManager.js');
                schedulerManager.reload();

                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Delete scheduled prompt
        this.app.delete('/api/scheduled-prompts/:id', requireAuth, async (req, res) => {
            const { id } = req.params;
            if (!db) return res.status(500).json({ error: 'DB not initialized' });

            try {
                db.deleteScheduledPrompt(parseInt(id));
                logger.info('Scheduled prompt deleted via dashboard', { id });

                // Reload scheduling engine
                const { default: schedulerManager } = await import('../bot/SchedulerManager.js');
                schedulerManager.reload();

                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ==================== Reminders API ====================

        // Get all reminders
        this.app.get('/api/reminders', requireAuth, (req, res) => {
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const reminders = db.getAllReminders();
                res.json({ success: true, reminders });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Add reminder
        this.app.post('/api/reminders', requireAuth, (req, res) => {
            const { title, dueDate, nudgeIntervalMinutes } = req.body;
            if (!title || !dueDate) {
                return res.status(400).json({ error: 'Title and due date are required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const id = db.addReminder(title, dueDate, nudgeIntervalMinutes || 60);
                res.json({ success: true, id });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Update reminder details
        this.app.put('/api/reminders/:id', requireAuth, (req, res) => {
            const { id } = req.params;
            const { title, dueDate, nudgeIntervalMinutes } = req.body;
            if (!title || !dueDate) {
                return res.status(400).json({ error: 'Title and due date are required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.updateReminder(parseInt(id), title, dueDate, nudgeIntervalMinutes || 60);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Update reminder status
        this.app.put('/api/reminders/:id/status', requireAuth, (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            if (!status || !['pending', 'done', 'cancelled'].includes(status)) {
                return res.status(400).json({ error: 'Valid status is required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.updateReminderStatus(parseInt(id), status);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Delete reminder
        this.app.delete('/api/reminders/:id', requireAuth, (req, res) => {
            const { id } = req.params;
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.deleteReminder(parseInt(id));
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // ==================== Settings API (DB-backed, Docker-safe) ====================

        // Get all settings (.env as baseline + DB overrides)
        this.app.get('/api/settings', requireAuth, (req, res) => {
            try {
                const settings = {};

                // 1. Read baseline from .env file
                const envPath = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, 'utf-8');
                    content.split('\n').forEach(line => {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) return;
                        const eqIdx = trimmed.indexOf('=');
                        if (eqIdx === -1) return;
                        const key = trimmed.substring(0, eqIdx).trim();
                        const value = trimmed.substring(eqIdx + 1).trim();
                        settings[key] = value;
                    });
                }

                // 2. Override with DB-stored settings (these take priority)
                if (db) {
                    const dbOverrides = db.getAllConfig();
                    const ENV_PREFIX = 'env_';
                    for (const [key, value] of Object.entries(dbOverrides)) {
                        if (key.startsWith(ENV_PREFIX)) {
                            const envKey = key.substring(ENV_PREFIX.length);
                            settings[envKey] = value;
                        }
                    }
                }

                res.json({ settings });
            } catch (err) {
                logger.error('Failed to read settings', { error: err.message });
                res.status(500).json({ error: 'Failed to read settings' });
            }
        });

        // Update settings (saves to DB, applies to process.env in memory)
        this.app.put('/api/settings', requireAuth, (req, res) => {
            const { settings } = req.body;
            if (!settings || typeof settings !== 'object') {
                return res.status(400).json({ error: 'Settings object is required' });
            }

            try {
                if (!db) {
                    return res.status(500).json({ error: 'DB not initialized' });
                }

                const ENV_PREFIX = 'env_';
                for (const [key, value] of Object.entries(settings)) {
                    // Save to DB with env_ prefix to distinguish from other config
                    db.setConfig(`${ENV_PREFIX}${key}`, value);

                    // Apply to process.env immediately
                    process.env[key] = value;
                }

                // Hot-reload config object for key settings
                if (settings.GEMINI_MODEL) {
                    config.gemini.model = settings.GEMINI_MODEL;
                }
                if (settings.GEMINI_API_KEY) {
                    config.gemini.apiKey = settings.GEMINI_API_KEY;
                }
                if (settings.WHATSAPP_WHITELIST) {
                    config.whatsapp.whitelist = settings.WHATSAPP_WHITELIST.split(',').map(s => s.trim()).filter(Boolean);
                }
                if (settings.WHATSAPP_GROUP_ID) {
                    config.whatsapp.groupId = settings.WHATSAPP_GROUP_ID;
                }
                if (settings.HOME_ASSISTANT_URL) {
                    config.homeAssistant.url = settings.HOME_ASSISTANT_URL;
                }
                if (settings.HOME_ASSISTANT_TOKEN) {
                    config.homeAssistant.token = settings.HOME_ASSISTANT_TOKEN;
                }
                if (settings.CALENDAR_ID) {
                    config.google.calendarId = settings.CALENDAR_ID;
                }
                if (settings.WEBHOOK_SECRET) {
                    config.dashboard.webhookSecret = settings.WEBHOOK_SECRET;
                }
                if (settings.LOG_LEVEL) {
                    config.logging.level = settings.LOG_LEVEL;
                }

                logger.info('Settings updated via dashboard (DB)', {
                    keys: Object.keys(settings)
                });

                res.json({ success: true, message: 'Settings saved. Some changes take effect immediately, others may require a restart.' });
            } catch (err) {
                logger.error('Failed to save settings', { error: err.message });
                res.status(500).json({ error: 'Failed to save settings' });
            }
        });

        // ==================== Backup & Restore API ====================

        this.app.get('/api/backup', requireAuth, (req, res) => {
            try {
                const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
                const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
                const backup = {
                    version: 2,
                    generated_at: new Date().toISOString(),
                    knowledge: {},
                    skills: {},
                    keywords: [],
                    ha_mappings: [],
                    scheduled_prompts: [],
                    settings: {}
                };

                // MD files
                if (fs.existsSync(knowledgeDir)) {
                    fs.readdirSync(knowledgeDir).forEach(file => {
                        if (file.endsWith('.md')) {
                            backup.knowledge[file] = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
                        }
                    });
                }
                if (fs.existsSync(skillsDir)) {
                    fs.readdirSync(skillsDir).forEach(file => {
                        if (file.endsWith('.md')) {
                            backup.skills[file] = fs.readFileSync(path.join(skillsDir, file), 'utf8');
                        }
                    });
                }

                // DB-backed data
                backup.keywords = db.getKeywords().map(k => ({
                    keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled
                }));
                backup.ha_mappings = db.getHaMappings().map(m => ({
                    entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type
                }));
                backup.scheduled_prompts = db.getScheduledPrompts().map(p => ({
                    name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled
                }));

                // Settings: .env baseline + DB overrides (same as GET /api/settings)
                const envPath = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, 'utf-8');
                    content.split('\n').forEach(line => {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) return;
                        const eqIdx = trimmed.indexOf('=');
                        if (eqIdx === -1) return;
                        backup.settings[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
                    });
                }
                const ENV_PREFIX = 'env_';
                const dbOverrides = db.getAllConfig();
                for (const [key, value] of Object.entries(dbOverrides)) {
                    if (key.startsWith(ENV_PREFIX)) {
                        backup.settings[key.substring(ENV_PREFIX.length)] = value;
                    }
                }

                res.setHeader('Content-disposition', `attachment; filename=noga_full_backup_${Date.now()}.json`);
                res.setHeader('Content-type', 'application/json');
                res.send(JSON.stringify(backup, null, 2));
            } catch (err) {
                logger.error('Failed to generate backup', { error: err.message });
                res.status(500).json({ error: 'Failed to generate backup' });
            }
        });

        this.app.post('/api/restore', requireAuth, express.json({limit: '10mb'}), (req, res) => {
            try {
                const { knowledge, skills, keywords, ha_mappings, scheduled_prompts, settings } = req.body;
                if (!knowledge && !skills && !keywords && !ha_mappings && !scheduled_prompts && !settings) {
                    return res.status(400).json({ error: 'Invalid backup format' });
                }

                const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
                const skillsDir = path.resolve(process.cwd(), 'data', 'skills');

                // Restore MD files
                if (knowledge) {
                    if (!fs.existsSync(knowledgeDir)) fs.mkdirSync(knowledgeDir, { recursive: true });
                    for (const [file, content] of Object.entries(knowledge)) {
                        if (file.endsWith('.md')) {
                            fs.writeFileSync(path.join(knowledgeDir, file), content, 'utf8');
                        }
                    }
                }
                if (skills) {
                    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
                    for (const [file, content] of Object.entries(skills)) {
                        if (file.endsWith('.md')) {
                            fs.writeFileSync(path.join(skillsDir, file), content, 'utf8');
                        }
                    }
                }

                // Restore DB-backed data
                if (db) {
                    if (keywords && Array.isArray(keywords)) {
                        // Clear existing keywords and re-insert
                        db.db.exec('DELETE FROM keywords');
                        for (const k of keywords) {
                            try { db.addKeyword(k.keyword, k.response, k.type || 'static'); } catch { /* skip duplicates */ }
                        }
                        logger.info('Restored keywords', { count: keywords.length });
                    }

                    if (ha_mappings && Array.isArray(ha_mappings)) {
                        db.db.exec('DELETE FROM ha_mappings');
                        for (const m of ha_mappings) {
                            try { db.addHaMapping(m.entity_id, m.nickname, m.location, m.type); } catch { /* skip duplicates */ }
                        }
                        logger.info('Restored HA mappings', { count: ha_mappings.length });
                    }

                    if (scheduled_prompts && Array.isArray(scheduled_prompts)) {
                        db.db.exec('DELETE FROM scheduled_prompts');
                        for (const p of scheduled_prompts) {
                            try { db.addScheduledPrompt(p.name, p.prompt, p.cron_expression, p.enabled); } catch { /* skip */ }
                        }
                        logger.info('Restored scheduled prompts', { count: scheduled_prompts.length });
                    }

                    if (settings && typeof settings === 'object') {
                        const ENV_PREFIX = 'env_';
                        for (const [key, value] of Object.entries(settings)) {
                            db.setConfig(`${ENV_PREFIX}${key}`, value);
                        }
                        logger.info('Restored settings', { count: Object.keys(settings).length });
                    }
                }

                // Notify UI to refresh
                if (this.io) {
                    this.io.emit('file_changed', { type: 'knowledge' });
                    this.io.emit('file_changed', { type: 'skills' });
                }

                // Re-initialize Gemini with updated files
                if (this.geminiManager) {
                    this.geminiManager.reinit();
                }

                res.json({ success: true, message: 'Full system backup restored successfully' });
            } catch (err) {
                logger.error('Failed to restore backup', { error: err.message });
                res.status(500).json({ error: 'Failed to restore backup' });
            }
        });

        // ---- Backup Management API ----

        const getBackupsDir = () => path.resolve(process.cwd(), 'data', 'backups');

        // GET /api/backups — list all saved backups
        this.app.get('/api/backups', requireAuth, (req, res) => {
            try {
                const backupsDir = getBackupsDir();
                if (!fs.existsSync(backupsDir)) return res.json({ backups: [] });

                const files = fs.readdirSync(backupsDir)
                    .filter(f => f.endsWith('.json'))
                    .map(f => {
                        const stat = fs.statSync(path.join(backupsDir, f));
                        return { filename: f, size: stat.size, created_at: stat.mtime.toISOString() };
                    })
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // newest first

                res.json({ backups: files });
            } catch (err) {
                logger.error('Failed to list backups', { error: err.message });
                res.status(500).json({ error: 'Failed to list backups' });
            }
        });

        // POST /api/backups/create — create a new backup now
        this.app.post('/api/backups/create', requireAuth, (req, res) => {
            try {
                const backupsDir = getBackupsDir();
                if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

                const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
                const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
                const backup = {
                    version: 2,
                    generated_at: new Date().toISOString(),
                    knowledge: {}, skills: {}, keywords: [],
                    ha_mappings: [], scheduled_prompts: [], settings: {}
                };

                if (fs.existsSync(knowledgeDir)) {
                    fs.readdirSync(knowledgeDir).forEach(f => {
                        if (f.endsWith('.md')) backup.knowledge[f] = fs.readFileSync(path.join(knowledgeDir, f), 'utf8');
                    });
                }
                if (fs.existsSync(skillsDir)) {
                    fs.readdirSync(skillsDir).forEach(f => {
                        if (f.endsWith('.md')) backup.skills[f] = fs.readFileSync(path.join(skillsDir, f), 'utf8');
                    });
                }
                backup.keywords = db.getKeywords().map(k => ({ keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled }));
                backup.ha_mappings = db.getHaMappings().map(m => ({ entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type }));
                backup.scheduled_prompts = db.getScheduledPrompts().map(p => ({ name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled }));

                // Settings: .env baseline + DB overrides
                const envPath2 = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(envPath2)) {
                    const content = fs.readFileSync(envPath2, 'utf-8');
                    content.split('\n').forEach(line => {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) return;
                        const eqIdx = trimmed.indexOf('=');
                        if (eqIdx === -1) return;
                        backup.settings[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
                    });
                }
                const dbOverrides2 = db.getAllConfig();
                for (const [key, value] of Object.entries(dbOverrides2)) {
                    if (key.startsWith('env_')) backup.settings[key.substring(4)] = value;
                }


                // Timestamped filename with seconds to allow multiple per day
                const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const filename = `noga_backup_${ts}.json`;
                const backupPath = path.join(backupsDir, filename);
                fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

                // Enforce retention limit
                const retention = parseInt(db.getConfig('backup_retention', 7)) || 7;
                const allFiles = fs.readdirSync(backupsDir)
                    .filter(f => f.endsWith('.json'))
                    .sort(); // ascending = oldest first
                if (allFiles.length > retention) {
                    allFiles.slice(0, allFiles.length - retention).forEach(old => {
                        fs.unlinkSync(path.join(backupsDir, old));
                        logger.info('Auto-deleted old backup', { file: old });
                    });
                }

                logger.info('Manual backup created', { filename });
                res.json({ success: true, filename });
            } catch (err) {
                logger.error('Failed to create backup', { error: err.message });
                res.status(500).json({ error: 'Failed to create backup' });
            }
        });

        // GET /api/backups/:filename/download — download a specific backup
        this.app.get('/api/backups/:filename/download', requireAuth, (req, res) => {
            try {
                const filename = path.basename(req.params.filename); // sanitize
                if (!filename.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
                const filePath = path.join(getBackupsDir(), filename);
                if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });
                res.setHeader('Content-disposition', `attachment; filename=${filename}`);
                res.setHeader('Content-type', 'application/json');
                fs.createReadStream(filePath).pipe(res);
            } catch (err) {
                res.status(500).json({ error: 'Failed to download backup' });
            }
        });

        // DELETE /api/backups/:filename — delete a specific backup
        this.app.delete('/api/backups/:filename', requireAuth, (req, res) => {
            try {
                const filename = path.basename(req.params.filename);
                if (!filename.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
                const filePath = path.join(getBackupsDir(), filename);
                if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });
                fs.unlinkSync(filePath);
                logger.info('Backup deleted', { filename });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: 'Failed to delete backup' });
            }
        });

        // GET /api/backup-settings — get retention setting
        this.app.get('/api/backup-settings', requireAuth, (req, res) => {
            const retention = parseInt(db.getConfig('backup_retention', 7)) || 7;
            res.json({ retention });
        });

        // POST /api/backup-settings — save retention setting
        this.app.post('/api/backup-settings', requireAuth, express.json(), (req, res) => {
            try {
                const retention = parseInt(req.body.retention);
                if (isNaN(retention) || retention < 1 || retention > 30) {
                    return res.status(400).json({ error: 'Retention must be between 1 and 30' });
                }
                db.setConfig('backup_retention', retention);
                logger.info('Backup retention updated', { retention });
                res.json({ success: true, retention });
            } catch (err) {
                res.status(500).json({ error: 'Failed to save backup settings' });
            }
        });


        // ==================== Home Assistant Mapping API ====================

        // Get all Home Assistant mappings
        this.app.get('/api/ha/mappings', requireAuth, (req, res) => {
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const mappings = db.getHaMappings();
                res.json({ mappings });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Add Home Assistant mapping
        this.app.post('/api/ha/mappings', requireAuth, (req, res) => {
            const { entityId, nickname, location, type } = req.body;
            if (!entityId || !nickname) {
                return res.status(400).json({ error: 'entityId and nickname are required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                const id = db.addHaMapping(entityId, nickname, location, type);
                logger.info('HA mapping added via dashboard', { entityId, nickname });
                res.json({ success: true, id });
            } catch (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(409).json({ error: 'Mapping for this entity already exists' });
                }
                res.status(500).json({ error: err.message });
            }
        });

        // Update Home Assistant mapping
        this.app.put('/api/ha/mappings/:id', requireAuth, (req, res) => {
            const { id } = req.params;
            const { entityId, nickname, location, type } = req.body;
            if (!entityId || !nickname) {
                return res.status(400).json({ error: 'entityId and nickname are required' });
            }
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.updateHaMapping(parseInt(id), entityId, nickname, location, type);
                logger.info('HA mapping updated via dashboard', { id, entityId });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Delete Home Assistant mapping
        this.app.delete('/api/ha/mappings/:id', requireAuth, (req, res) => {
            const { id } = req.params;
            if (!db) return res.status(500).json({ error: 'DB not initialized' });
            try {
                db.deleteHaMapping(parseInt(id));
                logger.info('HA mapping deleted via dashboard', { id });
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Proxy: Get entities from Home Assistant
        this.app.get('/api/ha/entities', requireAuth, async (req, res) => {
            try {
                const { homeAssistantManager } = await import('../skills/index.js');
                const result = await homeAssistantManager.getEntities();
                res.json(result);
            } catch (err) {
                logger.error('Failed to fetch entities for dashboard', { error: err.message });
                res.status(500).json({ error: 'Failed to fetch entities from Home Assistant' });
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

            // Dashboard Chat: Receive message from dashboard
            socket.on('dashboard_message', async (text) => {
                if (!this.messageRouter) {
                    return socket.emit('dashboard_response', { 
                        error: 'Message Router not initialized' 
                    });
                }

                try {
                    const response = await this.messageRouter.processText('dashboard_admin', text);
                    socket.emit('dashboard_response', { text: response });
                } catch (err) {
                    socket.emit('dashboard_response', { error: err.message });
                }
            });

            // Dashboard Chat: Clear history
            socket.on('clear_chat', () => {
                if (this.geminiManager) {
                    this.geminiManager.clearHistory('dashboard_admin');
                    socket.emit('chat_cleared');
                }
            });

            socket.on('disconnect', () => {
                logger.debug('Dashboard client disconnected', { id: socket.id });
            });
        });

        // Subscribe to log events and broadcast
        subscribeToLogs((logEntry) => {
            this.io.emit('log', logEntry);
        });

        // Setup file watching for live updates
        const watchDir = (dirPath, fileType) => {
            if (!fs.existsSync(dirPath)) return;
            fs.watch(dirPath, (eventType, filename) => {
                if (filename && filename.endsWith('.md')) {
                    this.io.emit('file_changed', { type: fileType, filename, eventType });
                }
            });
        };

        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        
        watchDir(knowledgeDir, 'knowledge');
        watchDir(skillsDir, 'skills');
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
    setManagers(geminiManager, db, messageRouter) {
        this.geminiManager = geminiManager;
        this.db = db;
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
