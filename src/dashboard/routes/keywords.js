import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import config from '../../utils/config.js';

export default function createKeywordsRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, schedulerManagerPromise } = deps;

    // ==================== Keywords API ====================

    // Get all keywords
    router.get('/api/keywords', requireAuth, asyncHandler(async (req, res) => {
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        const keywords = await db.getKeywords(config.tenantId);
        res.json({ keywords });
    }));

    // Add keyword
    router.post('/api/keywords', requireAuth, asyncHandler(async (req, res) => {
        const { keyword, response, type } = req.body;
        if (!keyword || !response) {
            const err = new Error('keyword and response are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        try {
            const id = await db.addKeyword(config.tenantId, keyword, response, type || 'static');
            logger.info('Keyword added via dashboard', { keyword, type: type || 'static' });
            res.json({ success: true, id });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Keyword already exists' });
            }
            throw err;
        }
    }));

    // Update keyword
    router.put('/api/keywords/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { keyword, response, enabled, type } = req.body;
        if (!keyword || !response) {
            const err = new Error('keyword and response are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        try {
            await db.updateKeyword(config.tenantId, parseInt(id), keyword, response, enabled !== false, type || 'static');
            logger.info('Keyword updated via dashboard', { id, keyword, type: type || 'static' });
            res.json({ success: true });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Keyword already exists' });
            }
            throw err;
        }
    }));

    // Delete keyword
    router.delete('/api/keywords/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        await db.deleteKeyword(config.tenantId, parseInt(id));
        logger.info('Keyword deleted via dashboard', { id });
        res.json({ success: true });
    }));

    // ==================== Scheduled Prompts API ====================

    // Get all scheduled prompts
    router.get('/api/scheduled-prompts', requireAuth, asyncHandler(async (req, res) => {
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        const prompts = await db.getScheduledPrompts(config.tenantId);
        res.json({ prompts });
    }));

    // Add scheduled prompt
    router.post('/api/scheduled-prompts', requireAuth, asyncHandler(async (req, res) => {
        const { name, prompt, cronExpression, enabled } = req.body;
        if (!name || !prompt || !cronExpression) {
            const err = new Error('Name, prompt, and cron expression are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }

        const id = await db.addScheduledPrompt(config.tenantId, name, prompt, cronExpression, enabled);
        logger.info('Scheduled prompt added via dashboard', { name });

        // Reload scheduling engine
        const schedulerManager = await schedulerManagerPromise;
        await schedulerManager.reload();

        res.json({ success: true, id });
    }));

    // Update scheduled prompt
    router.put('/api/scheduled-prompts/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { name, prompt, cronExpression, enabled } = req.body;
        if (!name || !prompt || !cronExpression) {
            const err = new Error('Name, prompt, and cron expression are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }

        await db.updateScheduledPrompt(config.tenantId, parseInt(id), name, prompt, cronExpression, enabled);
        logger.info('Scheduled prompt updated via dashboard', { id, name });

        // Reload scheduling engine
        const schedulerManager = await schedulerManagerPromise;
        await schedulerManager.reload();

        res.json({ success: true });
    }));

    // Delete scheduled prompt
    router.delete('/api/scheduled-prompts/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }

        await db.deleteScheduledPrompt(config.tenantId, parseInt(id));
        logger.info('Scheduled prompt deleted via dashboard', { id });

        // Reload scheduling engine
        const schedulerManager = await schedulerManagerPromise;
        await schedulerManager.reload();

        res.json({ success: true });
    }));

    return router;
}
