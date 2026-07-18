import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import config from '../../utils/config.js';
import tenantContext from '../../utils/tenantContext.js';

export default function createHaRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, skillsIndexPromise } = deps;

    // Get all Home Assistant mappings
    router.get('/api/ha/mappings', requireAuth, asyncHandler(async (req, res) => {
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        const mappings = await db.getHaMappings(tenantContext.getTenantId());
        res.json({ mappings });
    }));

    // Add Home Assistant mapping
    router.post('/api/ha/mappings', requireAuth, asyncHandler(async (req, res) => {
        const { entityId, nickname, location, type } = req.body;
        if (!entityId || !nickname) {
            const err = new Error('entityId and nickname are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        try {
            const id = await db.addHaMapping(tenantContext.getTenantId(), entityId, nickname, location, type);
            logger.info('HA mapping added via dashboard', { entityId, nickname });
            res.json({ success: true, id });
        } catch (err) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Mapping for this entity already exists' });
            }
            throw err;
        }
    }));

    // Update Home Assistant mapping
    router.put('/api/ha/mappings/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { entityId, nickname, location, type } = req.body;
        if (!entityId || !nickname) {
            const err = new Error('entityId and nickname are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        await db.updateHaMapping(tenantContext.getTenantId(), parseInt(id), entityId, nickname, location, type);
        logger.info('HA mapping updated via dashboard', { id, entityId });
        res.json({ success: true });
    }));

    // Delete Home Assistant mapping
    router.delete('/api/ha/mappings/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        await db.deleteHaMapping(tenantContext.getTenantId(), parseInt(id));
        logger.info('HA mapping deleted via dashboard', { id });
        res.json({ success: true });
    }));

    // Proxy: Get entities from Home Assistant
    router.get('/api/ha/entities', requireAuth, asyncHandler(async (req, res) => {
        const { homeAssistantManager } = await skillsIndexPromise;
        const ha = await homeAssistantManager.getCurrent();
        const result = await ha.getEntities();
        res.json(result);
    }));

    return router;
}
