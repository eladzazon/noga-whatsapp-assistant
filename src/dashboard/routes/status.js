import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../middleware/error.js';
import { readLastLines } from '../../utils/logger.js';

// Helper to count newlines streaming
function countNewlines(filePath) {
    return new Promise((resolve) => {
        let count = 0;
        fs.createReadStream(filePath)
            .on('data', (chunk) => {
                for (let i = 0; i < chunk.length; ++i) {
                    if (chunk[i] === 10) count++; // 10 is '\n'
                }
            })
            .on('end', () => resolve(count))
            .on('error', () => resolve(0));
    });
}

export default function createStatusRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, server } = deps;

    // API: Get status
    router.get('/api/status', requireAuth, asyncHandler(async (req, res) => {
        res.json({
            whatsapp: server.getWhatsAppStatus ? server.getWhatsAppStatus() : { isReady: false },
            gemini: server.getGeminiStatus ? server.getGeminiStatus() : { isInitialized: false },
            skills: server.getSkillsStatus ? await server.getSkillsStatus() : {},
            usage: db ? db.getUsageStats() : { today: {}, month: {} }
        });
    }));

    // API: Update config
    router.post('/api/config', requireAuth, asyncHandler(async (req, res) => {
        const { key, value } = req.body;

        if (server.onConfigUpdate) {
            server.onConfigUpdate(key, value);
        }

        res.json({ success: true });
    }));

    // API: Get logs
    router.get('/api/logs', requireAuth, asyncHandler(async (req, res) => {
        const count = parseInt(req.query.count) || 50;
        res.json(deps.getRecentLogs(count));
    }));

    // Health check
    router.get('/health', asyncHandler(async (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    }));

    // Restart application
    router.post('/api/restart', requireAuth, asyncHandler(async (req, res) => {
        logger.warn('Application restart requested from dashboard');
        res.json({ success: true, message: 'Restarting application...' });
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }));

    // Get server log file contents (optimized with backward-streaming and counts)
    router.get('/api/logs/file', requireAuth, asyncHandler(async (req, res) => {
        const lines = Math.min(parseInt(req.query.lines) || 500, 2000);
        const logPath = path.resolve(process.cwd(), 'data', 'logs', 'combined.log');

        let exists = false;
        try {
            await fs.promises.access(logPath);
            exists = true;
        } catch {
            // File does not exist
        }

        if (!exists) {
            return res.json({ logs: [], message: 'Log file not found. File logging is only available in production mode.' });
        }

        const [recentLines, totalLines] = await Promise.all([
            readLastLines(logPath, lines),
            countNewlines(logPath)
        ]);

        const parsedLogs = recentLines.map(line => {
            try {
                return JSON.parse(line);
            } catch {
                return { timestamp: '', level: 'info', message: line };
            }
        });

        res.json({ logs: parsedLogs, total: totalLines, showing: recentLines.length });
    }));

    return router;
}
