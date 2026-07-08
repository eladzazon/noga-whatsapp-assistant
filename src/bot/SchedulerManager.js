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
        this._scheduleReminderNudger();
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
                // Log under the main group ID so Noga remembers what she said
                const response = await this.geminiManager.processMessage(
                    config.whatsapp.groupId,
                    promptData.prompt
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
                
                let exists = false;
                try {
                    await fs.promises.access(backupsDir);
                    exists = true;
                } catch {}

                if (!exists) {
                    await fs.promises.mkdir(backupsDir, { recursive: true });
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
                    reminders: [],
                    settings: {}
                };

                let knowledgeExists = false;
                try {
                    await fs.promises.access(knowledgeDir);
                    knowledgeExists = true;
                } catch {}

                if (knowledgeExists) {
                    const files = await fs.promises.readdir(knowledgeDir);
                    await Promise.all(
                        files.map(async file => {
                            if (file.endsWith('.md')) {
                                backup.knowledge[file] = await fs.promises.readFile(path.join(knowledgeDir, file), 'utf8');
                            }
                        })
                    );
                }

                let skillsExists = false;
                try {
                    await fs.promises.access(skillsDir);
                    skillsExists = true;
                } catch {}

                if (skillsExists) {
                    const files = await fs.promises.readdir(skillsDir);
                    await Promise.all(
                        files.map(async file => {
                            if (file.endsWith('.md')) {
                                backup.skills[file] = await fs.promises.readFile(path.join(skillsDir, file), 'utf8');
                            }
                        })
                    );
                }

                // DB-backed data
                backup.keywords = db.getKeywords().map(k => ({ keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled }));
                backup.ha_mappings = db.getHaMappings().map(m => ({ entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type }));
                backup.scheduled_prompts = db.getScheduledPrompts().map(p => ({ name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled }));
                backup.reminders = db.getAllReminders();
                
                // Settings: .env baseline + DB overrides
                const envPath = path.resolve(process.cwd(), '.env');
                let envExists = false;
                try {
                    await fs.promises.access(envPath);
                    envExists = true;
                } catch {}

                if (envExists) {
                    const content = await fs.promises.readFile(envPath, 'utf-8');
                    content.split('\n').forEach(line => {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith('#')) return;
                        const eqIdx = trimmed.indexOf('=');
                        if (eqIdx === -1) return;
                        backup.settings[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
                    });
                }
                const allConfig = db.getAllConfig();
                const ENV_PREFIX = 'env_';
                for (const [key, value] of Object.entries(allConfig)) {
                    if (key.startsWith(ENV_PREFIX)) backup.settings[key.substring(ENV_PREFIX.length)] = value;
                }

                // Save to data/backups/ with a timestamp filename
                const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                const backupPath = path.join(backupsDir, `noga_backup_${dateStr}.json`);
                await fs.promises.writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');

                // Keep only last N backups (configured in admin UI, default 7, 0 means keep all)
                const retentionVal = db.getConfig('backup_retention', 7);
                const retention = retentionVal !== null && retentionVal !== undefined ? parseInt(retentionVal) : 7;
                if (retention > 0) {
                    const files = await fs.promises.readdir(backupsDir);
                    const backupFiles = files.filter(f => f.endsWith('.json')).sort(); // ascending = oldest first
                    if (backupFiles.length > retention) {
                        const filesToDelete = backupFiles.slice(0, backupFiles.length - retention);
                        for (const old of filesToDelete) {
                            await fs.promises.unlink(path.join(backupsDir, old));
                            logger.info('Deleted old backup', { file: old });
                        }
                    }
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
     * Schedule a task that checks for pending reminders every minute
     */
    _scheduleReminderNudger() {
        cron.schedule('* * * * *', async () => {
            try {
                if (!config.whatsapp.groupId) return;

                const { default: whatsappManager } = await import('./WhatsAppManager.js');
                if (!whatsappManager.isReady) return;

                const reminders = db.getPendingReminders();
                const now = new Date();

                for (const reminder of reminders) {
                    const dueDate = new Date(reminder.due_date);
                    if (now < dueDate) continue; // Not due yet

                    let shouldNudge = false;
                    if (reminder.nudge_count >= 10) {
                        db.updateReminderStatus(reminder.id, 'cancelled');
                        logger.info(`Reminder ${reminder.id} cancelled due to reaching nudge limit (10)`);
                        const msg = `אני מפסיקה לנדנד על המשימה "${reminder.title}". סימנתי אותה כמבוטלת.`;
                        await whatsappManager.sendMessage(config.whatsapp.groupId, msg);
                        continue;
                    }

                    if (!reminder.last_nudged) {
                        shouldNudge = true; // Never nudged
                        logger.debug(`Reminder ${reminder.id} needs first nudge (overdue and never nudged)`);
                    } else {
                        const lastNudgedDate = new Date(reminder.last_nudged);
                        // Add a 10-second buffer to handle cron timing jitter
                        const secondsSinceLastNudge = (now - lastNudgedDate) / 1000;
                        const requiredSeconds = (reminder.nudge_interval_minutes * 60) - 10;
                        
                        if (secondsSinceLastNudge >= requiredSeconds) {
                            shouldNudge = true;
                        } else {
                            const remaining = Math.round(requiredSeconds - secondsSinceLastNudge);
                            logger.debug(`Reminder ${reminder.id} ("${reminder.title}"): Skipping nudge, next one in ~${remaining}s`);
                        }
                    }

                    if (shouldNudge) {
                        // Quiet hours check for subsequent nudges (allow first send always)
                        if (reminder.last_nudged) {
                            const tzNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
                            const timeMinutes = tzNow.getHours() * 60 + tzNow.getMinutes();
                            const isQuietHours = timeMinutes >= (23 * 60 + 30) || timeMinutes < (5 * 60 + 30);
                            
                            if (isQuietHours) {
                                logger.debug(`Reminder ${reminder.id} skipped due to quiet hours (23:30 - 05:30)`);
                                continue;
                            }
                        }

                        // Use the tool-less broadcast model so we always get plain text back
                        const eventData = {
                            event: `Reminder Nudge: "${reminder.title}"`,
                            data: {
                                task: reminder.title,
                                due: dueDate.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }),
                                instruction: 'Send a short, friendly, nudging Hebrew WhatsApp message. Use emojis. Ask if they completed it. Mention they can mark it as done by reacting with a Like (👍) to this message, or by replying "עשיתי". They can also ask to snooze it.'
                            }
                        };

                        const response = await this.geminiManager.generateBroadcastMessage(eventData);

                        if (response && response.trim()) {
                            const sentMessageId = await whatsappManager.sendMessage(config.whatsapp.groupId, response);
                            
                            // Log to history with the internal ID appended so Noga remembers exactly which reminder this was
                            db.addChatMessage(config.whatsapp.groupId, 'model', `${response} [Internal Context: Reminder ID ${reminder.id}]`);
                            
                            db.updateReminderLastNudged(reminder.id);
                            if (sentMessageId) {
                                db.addReminderNudgeMessage(reminder.id, sentMessageId);
                            }
                            logger.info(`Sent nudge for reminder ${reminder.id}: "${reminder.title}"`, { sentMessageId });
                        }
                    }
                }
            } catch (err) {
                logger.error('Failed to run reminder nudger', { error: err.message });
            }
        });
    }
}

export default new SchedulerManager();
export { SchedulerManager };
