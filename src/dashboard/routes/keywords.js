import { Router } from 'express';

export default function createKeywordsRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, schedulerManagerPromise } = deps;

    // ==================== Keywords API ====================

    // Get all keywords
    router.get('/api/keywords', requireAuth, (req, res) => {
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            const keywords = db.getKeywords();
            res.json({ keywords });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add keyword
    router.post('/api/keywords', requireAuth, (req, res) => {
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
    router.put('/api/keywords/:id', requireAuth, (req, res) => {
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
    router.delete('/api/keywords/:id', requireAuth, (req, res) => {
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
    router.get('/api/scheduled-prompts', requireAuth, (req, res) => {
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            const prompts = db.getScheduledPrompts();
            res.json({ prompts });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add scheduled prompt
    router.post('/api/scheduled-prompts', requireAuth, async (req, res) => {
        const { name, prompt, cronExpression, enabled } = req.body;
        if (!name || !prompt || !cronExpression) {
            return res.status(400).json({ error: 'Name, prompt, and cron expression are required' });
        }
        if (!db) return res.status(500).json({ error: 'DB not initialized' });

        try {
            const id = db.addScheduledPrompt(name, prompt, cronExpression, enabled);
            logger.info('Scheduled prompt added via dashboard', { name });

            // Reload scheduling engine
            const schedulerManager = await schedulerManagerPromise;
            schedulerManager.reload();

            res.json({ success: true, id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update scheduled prompt
    router.put('/api/scheduled-prompts/:id', requireAuth, async (req, res) => {
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
            const schedulerManager = await schedulerManagerPromise;
            schedulerManager.reload();

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete scheduled prompt
    router.delete('/api/scheduled-prompts/:id', requireAuth, async (req, res) => {
        const { id } = req.params;
        if (!db) return res.status(500).json({ error: 'DB not initialized' });

        try {
            db.deleteScheduledPrompt(parseInt(id));
            logger.info('Scheduled prompt deleted via dashboard', { id });

            // Reload scheduling engine
            const schedulerManager = await schedulerManagerPromise;
            schedulerManager.reload();

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
