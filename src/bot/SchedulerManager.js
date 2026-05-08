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
        this._scheduleBirthdayReminders();
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
     * Schedule an automated daily backup saved to disk (data/backups/)
     */
    _scheduleAutomatedBackup() {
        // Run every day at 02:00 AM (Israel time)
        cron.schedule('0 2 * * *', async () => {
            logger.info('Running automated daily backup...');
            try {
                const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
                if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

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

                // Save to data/backups/ with a timestamp filename
                const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                const backupPath = path.join(backupsDir, `noga_backup_${dateStr}.json`);
                fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

                // Keep only last N backups (configured in admin UI, default 7)
                const retention = parseInt(db.getConfig('backup_retention', 7)) || 7;
                const backupFiles = fs.readdirSync(backupsDir)
                    .filter(f => f.endsWith('.json'))
                    .sort(); // ascending = oldest first
                if (backupFiles.length > retention) {
                    backupFiles.slice(0, backupFiles.length - retention).forEach(old => {
                        fs.unlinkSync(path.join(backupsDir, old));
                        logger.info('Deleted old backup', { file: old });
                    });
                }

                const kCount = Object.keys(backup.knowledge).length;
                const sCount = Object.keys(backup.skills).length;
                logger.info('Automated daily backup saved to disk', { path: backupPath, kCount, sCount });
            } catch (err) {
                logger.error('Automated backup failed', { error: err.message });
            }
        }, { scheduled: true, timezone: 'Asia/Jerusalem' });

        logger.info('Automated daily backup scheduled at 02:00 AM (Asia/Jerusalem) → saves to data/backups/');
    }

    /**
     * Schedule daily birthday & yearly-event reminders at 08:00 AM
     * Sends a WhatsApp message to ADMIN_PHONE (and group if configured)
     * when there are birthdays or yearly events today or in the next 7 days.
     */
    _scheduleBirthdayReminders() {
        // Run every day at 08:00 AM (Israel time)
        cron.schedule('0 8 * * *', async () => {
            logger.info('Running birthday/event reminder check...');
            try {
                // Check if calendar is configured
                if (!config.google?.eventsCalendarId && !config.google?.birthdaysCalendarId) {
                    logger.debug('Birthday reminders: no special calendars configured, skipping');
                    return;
                }

                const { calendarManager } = await import('../skills/index.js');
                const result = await calendarManager.checkUpcomingBirthdays(7);

                if (!result.success || result.count === 0) {
                    logger.info('Birthday reminder: no upcoming events in the next 7 days');
                    return;
                }

                const whatsappManager = (await import('./WhatsAppManager.js')).default;
                if (!whatsappManager.getStatus().isReady) {
                    logger.warn('Birthday reminder: WhatsApp not ready, skipping');
                    return;
                }

                // Build message
                const today = result.events.filter(e => e.isToday);
                const upcoming = result.events.filter(e => !e.isToday);

                let lines = ['🎂 *תזכורת אירועים קרובים*\n'];

                if (today.length > 0) {
                    lines.push('*היום:*');
                    today.forEach(e => lines.push(`  ${e.calendar} ${e.title}`));
                }
                if (upcoming.length > 0) {
                    lines.push('\n*השבוע הקרוב:*');
                    upcoming.forEach(e => {
                        const inDays = e.daysUntil === 1 ? 'מחר' : `בעוד ${e.daysUntil} ימים`;
                        lines.push(`  ${e.calendar} ${e.title} (${inDays})`);
                    });
                }

                const message = lines.join('\n');

                // Send to admin
                if (config.whatsapp.adminPhone) {
                    const adminJid = `${config.whatsapp.adminPhone}@s.whatsapp.net`;
                    await whatsappManager.sendMessage(adminJid, message);
                    logger.info('Birthday reminder sent to admin');
                }

                // Also send to group if there are events TODAY
                if (today.length > 0 && config.whatsapp.groupId) {
                    const eventTitles = today.map(e => e.title).join(', ');
                    const groupMsg = this.geminiManager
                        ? await this.geminiManager.processMessage('system_birthday',
                            `כתוב הודעת ברכה קצרה וחמה לקבוצה המשפחתית בעברית עם אמוג'ים לאירועים: ${eventTitles}`,
                            { keepHistory: false })
                        : `🎉 ${eventTitles}`;
                    await whatsappManager.sendMessage(config.whatsapp.groupId, groupMsg);
                    logger.info('Birthday group message sent');
                }
            } catch (err) {
                logger.error('Birthday reminder failed', { error: err.message });
            }
        }, { scheduled: true, timezone: 'Asia/Jerusalem' });

        logger.info('Birthday/event reminder scheduled at 08:00 AM (Asia/Jerusalem)');
    }
}

export default new SchedulerManager();
export { SchedulerManager };
