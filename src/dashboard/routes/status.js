import { Router } from 'express';
import fs from 'fs';
import path from 'path';

export default function createStatusRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, server } = deps;

    // API: Get status
    router.get('/api/status', requireAuth, (req, res) => {
        res.json({
            whatsapp: server.getWhatsAppStatus ? server.getWhatsAppStatus() : { isReady: false },
            gemini: server.getGeminiStatus ? server.getGeminiStatus() : { isInitialized: false },
            skills: server.getSkillsStatus ? server.getSkillsStatus() : {},
            usage: db ? db.getUsageStats() : { today: {}, month: {} }
        });
    });

    // API: Update config
    router.post('/api/config', requireAuth, (req, res) => {
        const { key, value } = req.body;

        if (server.onConfigUpdate) {
            server.onConfigUpdate(key, value);
        }

        res.json({ success: true });
    });

    // API: Get logs
    router.get('/api/logs', requireAuth, (req, res) => {
        const count = parseInt(req.query.count) || 50;
        res.json(deps.getRecentLogs(count));
    });

    // Health check
    router.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Restart application
    router.post('/api/restart', requireAuth, (req, res) => {
        logger.warn('Application restart requested from dashboard');
        res.json({ success: true, message: 'Restarting application...' });
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    });

    // Get server log file contents
    router.get('/api/logs/file', requireAuth, (req, res) => {
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

    return router;
}
