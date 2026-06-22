import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../middleware/error.js';

export default function createWhatsappRoutes(deps) {
    const router = Router();
    const { requireAuth, config, logger, whatsappManagerPromise, upload, server, db } = deps;

    // WhatsApp Disconnect
    router.post('/api/whatsapp/disconnect', requireAuth, asyncHandler(async (req, res) => {
        const whatsappManager = await whatsappManagerPromise;
        await whatsappManager.logout();
        res.json({ success: true, message: 'WhatsApp disconnected successfully. Scan new QR code.' });
    }));

    // WhatsApp Reconnect (manual - used after 405 errors)
    router.post('/api/whatsapp/reconnect', requireAuth, asyncHandler(async (req, res) => {
        const whatsappManager = await whatsappManagerPromise;
        await whatsappManager.reconnect();
        res.json({ success: true, message: 'Reconnecting WhatsApp. Please wait for QR code...' });
    }));

    // ==================== Webhook API ====================

    // Status webhook (for Home Assistant)
    router.get('/api/webhook/status', asyncHandler(async (req, res) => {
        const secret = req.headers['x-webhook-secret'] || req.query.secret;

        // Verify Secret
        if (!config.dashboard.webhookSecret || secret !== config.dashboard.webhookSecret) {
            logger.warn('Unauthorized status webhook attempt', { ip: req.ip });
            return res.status(401).json({ error: 'Unauthorized' });
        }

        res.json({
            whatsapp: server.getWhatsAppStatus ? server.getWhatsAppStatus() : { isReady: false },
            gemini: server.getGeminiStatus ? server.getGeminiStatus() : { isInitialized: false },
            skills: server.getSkillsStatus ? await server.getSkillsStatus() : {},
            usage: db ? db.getUsageStats() : { today: {}, month: {} }
        });
    }));

    // Notification webhook (for Home Assistant)
    // Accepts application/json OR multipart/form-data (for image uploads)
    router.post('/api/notify', upload.single('image'), asyncHandler(async (req, res) => {
        const event = req.body.event;
        // 'message' is an alternative to 'event' specifically for raw/passthrough sends
        const rawMessage = req.body.message;
        // Accept boolean true, or the strings "true"/"1" (form-data/query values arrive as strings)
        const isRaw = req.body.raw === true || req.body.raw === 'true' || req.body.raw === '1'
            || req.query.raw === 'true' || req.query.raw === '1';
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
        // For raw passthrough, accept either 'message' or 'event' as the literal text.
        // For AI-composed broadcasts, 'event' is still required.
        if (isRaw && !rawMessage && !event) {
            return res.status(400).json({ error: '"message" (or "event") is required when raw=true' });
        }
        if (!isRaw && !event) {
            return res.status(400).json({ error: 'Event name required' });
        }

        // 3. Process Webhook
        logger.info('Webhook received', { event, raw: isRaw });

        try {
            // Generate message:
            // - Image uploads always use the literal event text as the caption
            // - raw=true sends the literal text (message, falling back to event) with no AI rewrite
            // - otherwise, AI composes a friendly broadcast from event + data
            let message;
            if (req.file) {
                message = event;
            } else if (isRaw) {
                message = rawMessage || event;
            } else {
                message = await server.geminiManager.generateBroadcastMessage({ event, ...data });
            }

            // Send to WhatsApp Group
            if (config.whatsapp.groupId) {
                const whatsappStatus = server.getWhatsAppStatus ? server.getWhatsAppStatus() : { isReady: false };

                if (whatsappStatus.isReady) {
                    const whatsappManager = await whatsappManagerPromise;
                    
                    let messageSent = false;
                    
                    // If an image was uploaded, send it as media
                    if (req.file) {
                        try {
                            // Provide a default extension if missing so WhatsApp knows it's an image
                            const fileExt = path.extname(req.file.originalname) || '.jpg';
                            const tempPath = req.file.path;
                            const mediaPath = tempPath + fileExt;
                            await fs.promises.rename(tempPath, mediaPath);
                            
                            await whatsappManager.sendMediaMessage(config.whatsapp.groupId, mediaPath, message);
                            
                            // Log to history
                            if (db) {
                                db.addChatMessage(config.whatsapp.groupId, 'model', `[Image Notification] ${message}`);
                            }

                            // Clean up
                            await fs.promises.unlink(mediaPath);
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
                        if (db) {
                            db.addChatMessage(config.whatsapp.groupId, 'model', message);
                        }
                    }
                    
                    return res.json({ success: true, message, hasImage: !!req.file });
                } else {
                    // Clean up file if WA not ready
                    if (req.file) {
                        try { await fs.promises.unlink(req.file.path); } catch (e) {}
                    }
                    return res.status(503).json({ error: 'WhatsApp client not ready' });
                }
            } else {
                if (req.file) {
                    try { await fs.promises.unlink(req.file.path); } catch (e) {}
                }
                return res.status(400).json({ error: 'WHATSAPP_GROUP_ID not configured' });
            }

        } catch (err) {
            if (req.file) {
                try { await fs.promises.unlink(req.file.path); } catch (e) {}
            }
            throw err; // Let centralized errorHandler handle it
        }
    }));

    // Create reminder via webhook (for Home Assistant automations)
    router.post('/api/webhook/reminder', asyncHandler(async (req, res) => {
        const secret = req.headers['x-webhook-secret'] || req.query.secret || req.body.secret;

        // 1. Verify Secret
        if (!config.dashboard.webhookSecret || secret !== config.dashboard.webhookSecret) {
            logger.warn('Unauthorized webhook/reminder attempt', { ip: req.ip });
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. Validate required fields
        const { title, due_date, nudge_interval_minutes } = req.body;
        if (!title) {
            return res.status(400).json({ error: 'title is required' });
        }

        // 3. Resolve due_date — supports ISO string or relative shorthand (+10m, +1h, +2h30m)
        let resolvedDueDate;
        const dueDateStr = (due_date || '').trim();

        if (!dueDateStr) {
            // Default: 5 minutes from now
            resolvedDueDate = new Date(Date.now() + 5 * 60000).toISOString();
        } else if (/^\+/.test(dueDateStr)) {
            // Relative format: +10m, +1h, +2h30m, +90m etc.
            let totalMinutes = 0;
            const hourMatch = dueDateStr.match(/(\d+)\s*h/i);
            const minMatch = dueDateStr.match(/(\d+)\s*m/i);
            if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
            if (minMatch) totalMinutes += parseInt(minMatch[1]);
            if (totalMinutes <= 0) totalMinutes = 5; // fallback
            resolvedDueDate = new Date(Date.now() + totalMinutes * 60000).toISOString();
        } else {
            // Assume ISO string
            resolvedDueDate = new Date(dueDateStr).toISOString();
        }

        // 4. Create reminder
        const interval = parseInt(nudge_interval_minutes) || 60;
        const id = db.addReminder(title, resolvedDueDate, interval);

        logger.info('Webhook reminder created', { id, title, due_date: resolvedDueDate, interval });

        res.json({ success: true, id, title, due_date: resolvedDueDate, nudge_interval_minutes: interval });
    }));

    return router;
}
