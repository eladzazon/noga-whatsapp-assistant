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
            const message = req.file ? event : await server.geminiManager.generateBroadcastMessage({ event, ...data });

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

    return router;
}
