import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import config from '../../utils/config.js';
import memoryManager from '../../skills/MemoryManager.js';

export default function createTenantsRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger } = deps;

    // List every tenant (pending and approved)
    router.get('/api/tenants', requireAuth, asyncHandler(async (req, res) => {
        const profiles = await db.getAllProfiles();
        // Never send ha_token to the client
        const sanitized = profiles.map(p => ({
            tenant_id: p.tenant_id,
            display_name: p.display_name,
            group_jid: p.group_jid,
            ha_url: p.ha_url,
            has_ha_token: !!p.ha_token,
            google_calendar_id: p.google_calendar_id,
            enabled: p.enabled,
            created_at: p.created_at
        }));
        res.json({
            profiles: sanitized,
            defaultTenantId: config.tenantId,
            selectedTenantId: (req.session && req.session.tenantId) || config.tenantId
        });
    }));

    // Switch which tenant's data the rest of the dashboard (keywords, reminders, knowledge,
    // settings, etc.) operates on for this admin session. No effect on WhatsApp message routing.
    router.post('/api/session/tenant', requireAuth, asyncHandler(async (req, res) => {
        const { tenantId } = req.body;
        if (!tenantId) {
            return res.status(400).json({ error: 'tenantId is required' });
        }
        const profile = await db.getProfileByTenantId(tenantId);
        if (!profile || !profile.enabled) {
            return res.status(400).json({ error: 'Unknown or unapproved tenant' });
        }
        req.session.tenantId = tenantId;
        res.json({ success: true });
    }));

    // Approve a pending tenant (or update an already-approved one) with its credentials
    router.post('/api/tenants/:id/approve', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { haUrl, haToken, googleCalendarId, displayName } = req.body;

        await db.approveProfile(id, { haUrl, haToken, googleCalendarId, displayName });

        // A newly-approved tenant needs its own knowledge/skills directory seeded before its
        // first message arrives, same as the default tenant gets at startup.
        await memoryManager.init(id);

        logger.info('Tenant approved via dashboard', { tenantId: id });
        res.json({ success: true });
    }));

    // Reject (delete) a still-pending tenant
    router.delete('/api/tenants/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const removed = await db.rejectProfile(id);
        if (!removed) {
            return res.status(400).json({ error: 'Tenant not found or already approved (use approve to update an approved tenant, not delete)' });
        }
        logger.info('Pending tenant rejected via dashboard', { tenantId: id });
        res.json({ success: true });
    }));

    return router;
}
