import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../middleware/error.js';

// Helper to check file/dir existence asynchronously
async function exists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export default function createSettingsRoutes(deps) {
    const router = Router();
    const { requireAuth, db, config, logger } = deps;

    // ==================== Settings API (DB-backed, Docker-safe) ====================

    // Get all settings (.env as baseline + DB overrides)
    router.get('/api/settings', requireAuth, asyncHandler(async (req, res) => {
        const settings = {};

        // 1. Read baseline from .env file
        const envPath = path.resolve(process.cwd(), '.env');
        if (await exists(envPath)) {
            const content = await fs.promises.readFile(envPath, 'utf-8');
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
    }));

    // Update settings (saves to DB, applies to process.env in memory)
    router.put('/api/settings', requireAuth, asyncHandler(async (req, res) => {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'Settings object is required' });
        }

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
        if (settings.GEMINI_CONTEXT_WINDOW_MESSAGES) {
            config.gemini.contextWindowMessages = parseInt(settings.GEMINI_CONTEXT_WINDOW_MESSAGES, 10) || 10;
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
        if (settings.CALENDAR_EXTRA_IDS !== undefined) {
            config.google.extraCalendarIds = settings.CALENDAR_EXTRA_IDS
                .split(',').map(s => s.trim()).filter(Boolean);
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
    }));

    return router;
}
