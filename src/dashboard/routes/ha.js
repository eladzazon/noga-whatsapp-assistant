import { Router } from 'express';

export default function createHaRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, skillsIndexPromise } = deps;

    // Get all Home Assistant mappings
    router.get('/api/ha/mappings', requireAuth, (req, res) => {
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            const mappings = db.getHaMappings();
            res.json({ mappings });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add Home Assistant mapping
    router.post('/api/ha/mappings', requireAuth, (req, res) => {
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
    router.put('/api/ha/mappings/:id', requireAuth, (req, res) => {
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
    router.delete('/api/ha/mappings/:id', requireAuth, (req, res) => {
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
    router.get('/api/ha/entities', requireAuth, async (req, res) => {
        try {
            const { homeAssistantManager } = await skillsIndexPromise;
            const result = await homeAssistantManager.getEntities();
            res.json(result);
        } catch (err) {
            logger.error('Failed to fetch entities for dashboard', { error: err.message });
            res.status(500).json({ error: 'Failed to fetch entities from Home Assistant' });
        }
    });

    return router;
}
