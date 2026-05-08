import cron from 'node-cron';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import config from '../utils/config.js';
import fs from 'fs';
import path from 'path';

class SchedulerManager {
    constructor() {
        this.scheduledTasks = new Map(); // Maps prompt ID to node-cron task
        this.geminiManager = null;
    }

    /**
     * Initialize the scheduler
     * @param {Object} geminiManager - Instance of GeminiManager for processing prompts
     */
    init(geminiManager) {
        this.geminiManager = geminiManager;
        logger.info('Initializing Scheduler Manager...');
        this.reload();
        this._scheduleAutomatedBackup();
        return this;
    }

    /**
     * Stop all tasks and reload from database
     */
    reload() {
        logger.info('Reloading scheduled prompts...');

        // Stop all existing tasks
        for (const [id, task] of this.scheduledTasks.entries()) {
            task.stop();
        }
        this.scheduledTasks.clear();

        // Load new tasks
        const prompts = db.getEnabledScheduledPrompts();

        for (const prompt of prompts) {
            this._scheduleTask(prompt);
        }

        logger.info(`Loaded ${this.scheduledTasks.size} scheduled prompts`);
    }

    /**
     * Schedule a single task
     * @param {Object} promptData - Data from database
     */
    _scheduleTask(promptData) {
        if (!cron.validate(promptData.cron_expression)) {
            logger.error(`Invalid cron expression for scheduled prompt: ${promptData.name}`, {
                cron: promptData.cron_expression
            });
            return;
        }

        const task = cron.schedule(promptData.cron_expression, async () => {
            logger.info(`Running scheduled prompt: ${promptData.name}`);

            try {
                if (!config.whatsapp.groupId) {
                    logger.warn('Cannot run scheduled prompt: WHATSAPP_GROUP_ID is not configured');
                    return;
                }

                // Make sure WhatsApp is connected
                const { default: whatsappManager } = await import('./WhatsAppManager.js');
                const status = whatsappManager.getStatus();

                if (!status.isReady) {
                    logger.warn(`WhatsApp not ready, skipping scheduled prompt: ${promptData.name}`);
                    return;
                }

                // 1. Process the prompt with Gemini
                // We pass in a special system user ID for context tracking if needed
                const response = await this.geminiManager.processMessage(
                    'system_scheduler',
                    promptData.prompt,
                    { keepHistory: false } // Force fresh context for scheduled tasks
                );

                // 2. Send the response to the WhatsApp group
                if (response && response.trim()) {
                    await whatsappManager.sendMessage(config.whatsapp.groupId, response);
                    logger.info(`Scheduled prompt sent successfully: ${promptData.name}`);
                } else {
                    logger.warn(`Scheduled prompt generated empty response: ${promptData.name}`);
                }

            } catch (err) {
                logger.error(`Failed to execute scheduled prompt: ${promptData.name}`, { error: err.message, stack: err.stack });
            }
        }, {
            scheduled: true,
            timezone: 'Asia/Jerusalem'
        });

        this.scheduledTasks.set(promptData.id, task);
    }

    /**
     * Schedule an automated daily backup sent to the admin via WhatsApp
     */
    _scheduleAutomatedBackup() {
        if (!config.whatsapp.adminPhone) {
            logger.info('Automated backup skipped: ADMIN_PHONE not configured.');
            return;
        }

        // Run every day at 02:00 AM (Israel time)
        cron.schedule('0 2 * * *', async () => {
            logger.info('Running automated daily backup...');
            try {
                const { default: whatsappManager } = await import('./WhatsAppManager.js');
                if (!whatsappManager.getStatus().isReady) {
                    logger.warn('Automated backup skipped: WhatsApp not ready.');
                    return;
                }

                const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
                const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
                const backup = {
                    version: 2,
                    generated_at: new Date().toISOString(),
                    knowledge: {},
                    skills: {},
                    keywords: [],
                    ha_mappings: [],
                    scheduled_prompts: [],
                    settings: {}
                };

                if (fs.existsSync(knowledgeDir)) {
                    fs.readdirSync(knowledgeDir).forEach(file => {
                        if (file.endsWith('.md')) backup.knowledge[file] = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
                    });
                }
                if (fs.existsSync(skillsDir)) {
                    fs.readdirSync(skillsDir).forEach(file => {
                        if (file.endsWith('.md')) backup.skills[file] = fs.readFileSync(path.join(skillsDir, file), 'utf8');
                    });
                }

                // DB-backed data
                backup.keywords = db.getKeywords().map(k => ({ keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled }));
                backup.ha_mappings = db.getHaMappings().map(m => ({ entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type }));
                backup.scheduled_prompts = db.getScheduledPrompts().map(p => ({ name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled }));
                const allConfig = db.getAllConfig();
                const ENV_PREFIX = 'env_';
                for (const [key, value] of Object.entries(allConfig)) {
                    if (key.startsWith(ENV_PREFIX)) backup.settings[key.substring(ENV_PREFIX.length)] = value;
                }

                const kCount = Object.keys(backup.knowledge).length;
                const sCount = Object.keys(backup.skills).length;

                const backupPath = path.resolve(process.cwd(), 'data', `noga_full_backup_${Date.now()}.json`);
                fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

                const adminJid = `${config.whatsapp.adminPhone}@s.whatsapp.net`;
                await whatsappManager.sendMediaMessage(adminJid, backupPath,
                    `📦 גיבוי מלא אוטומטי יומי | ${kCount} קבצי ידע, ${sCount} כישורים, ${backup.keywords.length} מילות מפתח, ${backup.ha_mappings.length} התאמות HA`);

                fs.unlinkSync(backupPath);
                logger.info('Automated full daily backup sent successfully', { kCount, sCount });
            } catch (err) {
                logger.error('Automated backup failed', { error: err.message });
            }
        }, { scheduled: true, timezone: 'Asia/Jerusalem' });

        logger.info('Automated daily backup scheduled at 02:00 AM (Asia/Jerusalem)');
    }
}

export default new SchedulerManager();
export { SchedulerManager };
