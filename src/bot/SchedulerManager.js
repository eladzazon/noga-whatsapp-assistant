import cron from 'node-cron';
import axios from 'axios';
import logger, { readLastLines } from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import config from '../utils/config.js';
import tenantContext from '../utils/tenantContext.js';
import { getVersionInfo } from '../utils/version.js';
import memoryManager from '../skills/MemoryManager.js';
import fs from 'fs';
import path from 'path';

const UPDATE_FEED_URL = 'https://api.github.com/repos/eladzazon/noga-whatsapp-assistant/releases/latest';

// Compares two semver strings (ignoring an optional leading "v"). Returns true if `latest` > `current`.
function isNewerVersion(latest, current) {
    const parse = (v) => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const [lMajor, lMinor, lPatch] = parse(latest);
    const [cMajor, cMinor, cPatch] = parse(current);
    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
}

class SchedulerManager {
    constructor() {
        this.scheduledTasks = new Map(); // Maps prompt ID to node-cron task
        this.geminiManager = null;
    }

    /**
     * Initialize the scheduler
     * @param {Object} geminiManager - Instance of GeminiManager for processing prompts
     */
    async init(geminiManager) {
        this.geminiManager = geminiManager;
        logger.info('Initializing Scheduler Manager...');
        await this.reload();
        this._scheduleAutomatedBackup();
        this._scheduleReminderNudger();
        this._scheduleUpdateCheck();
        this._scheduleSelfDiagnostics();
        return this;
    }

    /**
     * Stop all tasks and reload from database, across every enabled tenant.
     */
    async reload() {
        logger.info('Reloading scheduled prompts...');

        // Stop all existing tasks
        for (const [id, task] of this.scheduledTasks.entries()) {
            task.stop();
        }
        this.scheduledTasks.clear();

        // Load new tasks — Phase 1 of Block 4: db.getEnabledProfiles() returns just the single
        // default tenant today, but the loop is here so Phase 2 (admin approval flow) doesn't
        // need to touch this again once more tenants exist.
        const profiles = await db.getEnabledProfiles();
        for (const profile of profiles) {
            const prompts = await db.getEnabledScheduledPrompts(profile.tenant_id);
            for (const prompt of prompts) {
                this._scheduleTask(profile.tenant_id, prompt);
            }
        }

        logger.info(`Loaded ${this.scheduledTasks.size} scheduled prompts`);
    }

    /**
     * Schedule a single task, bound to the tenant it was loaded for.
     * @param {string} tenantId - Tenant this scheduled prompt belongs to
     * @param {Object} promptData - Data from database
     */
    _scheduleTask(tenantId, promptData) {
        if (!cron.validate(promptData.cron_expression)) {
            logger.error(`Invalid cron expression for scheduled prompt: ${promptData.name}`, {
                cron: promptData.cron_expression
            });
            return;
        }

        const task = cron.schedule(promptData.cron_expression, async () => {
            await tenantContext.run(tenantId, async () => {
                logger.info(`Running scheduled prompt: ${promptData.name}`);

                try {
                    // Phase 1: still the single global WhatsApp destination — profiles.group_jid
                    // becomes the per-tenant destination once Phase 2's admin approval flow lands
                    // (config.whatsapp.groupId may have drifted from profiles.group_jid since the
                    // Block 2 migration, so switching this now risks a silent behavior change).
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
            });
        }, {
            scheduled: true,
            timezone: 'Asia/Jerusalem'
        });

        this.scheduledTasks.set(promptData.id, task);
    }

    /**
     * Schedule an automated daily backup saved to disk (data/backups/), once per enabled tenant.
     */
    _scheduleAutomatedBackup() {
        // Run every day at 02:00 AM (Israel time)
        cron.schedule('0 2 * * *', async () => {
            const profiles = await db.getEnabledProfiles();
            for (const profile of profiles) {
                await tenantContext.run(profile.tenant_id, () => this._runAutomatedBackupTick());
            }
        }, { scheduled: true, timezone: 'Asia/Jerusalem' });

        logger.info('Automated daily backup scheduled at 02:00 AM (Asia/Jerusalem) → saves to data/backups/');
    }

    async _runAutomatedBackupTick() {
        const tenantId = tenantContext.getTenantId();
        logger.info('Running automated daily backup...', { tenantId });
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

            const knowledgeFiles = await memoryManager.getKnowledgeFiles(tenantId);
            for (const f of knowledgeFiles) backup.knowledge[f.name] = f.content;
            const skillFiles = await memoryManager.getSkillFiles(tenantId);
            for (const f of skillFiles) backup.skills[f.name] = f.content;

            // DB-backed data
            backup.keywords = (await db.getKeywords(tenantId)).map(k => ({ keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled }));
            backup.ha_mappings = (await db.getHaMappings(tenantId)).map(m => ({ entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type }));
            backup.scheduled_prompts = (await db.getScheduledPrompts(tenantId)).map(p => ({ name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled }));
            backup.reminders = await db.getAllReminders(tenantId);

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
            const allConfig = await db.getAllConfig(tenantId);
            const ENV_PREFIX = 'env_';
            for (const [key, value] of Object.entries(allConfig)) {
                if (key.startsWith(ENV_PREFIX)) backup.settings[key.substring(ENV_PREFIX.length)] = value;
            }

            // Save to data/backups/ with a timestamp filename
            const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const backupPath = path.join(backupsDir, `noga_backup_${dateStr}.json`);
            await fs.promises.writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');

            // Keep only last N backups (configured in admin UI, default 7, 0 means keep all)
            const retentionVal = await db.getConfig(tenantId, 'backup_retention', 7);
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
            logger.info('Automated daily backup saved to disk', { tenantId, path: backupPath, kCount, sCount });
        } catch (err) {
            logger.error('Automated backup failed', { tenantId, error: err.message });
        }
    }

    /**
     * Schedule a task that checks for pending reminders every minute, once per enabled tenant.
     */
    _scheduleReminderNudger() {
        cron.schedule('* * * * *', async () => {
            const profiles = await db.getEnabledProfiles();
            for (const profile of profiles) {
                await tenantContext.run(profile.tenant_id, () => this._runReminderNudgerTick());
            }
        });
    }

    async _runReminderNudgerTick() {
        const tenantId = tenantContext.getTenantId();
        try {
            if (!config.whatsapp.groupId) return;

            const { default: whatsappManager } = await import('./WhatsAppManager.js');
            if (!whatsappManager.isReady) return;

            const reminders = await db.getPendingReminders(tenantId);
            const now = new Date();

            for (const reminder of reminders) {
                const dueDate = new Date(reminder.due_date);
                if (now < dueDate) continue; // Not due yet

                let shouldNudge = false;
                if (reminder.nudge_count >= 10) {
                    await db.updateReminderStatus(tenantId, reminder.id, 'cancelled');
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
                        await db.addChatMessage(tenantId, config.whatsapp.groupId, 'model', `${response} [Internal Context: Reminder ID ${reminder.id}]`);

                        await db.updateReminderLastNudged(tenantId, reminder.id);
                        if (sentMessageId) {
                            await db.addReminderNudgeMessage(tenantId, reminder.id, sentMessageId);
                        }
                        logger.info(`Sent nudge for reminder ${reminder.id}: "${reminder.title}"`, { sentMessageId });
                    }
                }
            }
        } catch (err) {
            logger.error('Failed to run reminder nudger', { tenantId, error: err.message });
        }
    }

    /**
     * Daily check against GitHub Releases for a newer version than the one running.
     * Non-blocking, fails silently on network error, never auto-applies.
     */
    _scheduleUpdateCheck() {
        const runCheck = async () => {
            try {
                const { data } = await axios.get(UPDATE_FEED_URL, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'NogaBot-UpdateChecker' }
                });

                const latestVersion = String(data.tag_name || '').replace(/^v/i, '');
                const { version: currentVersion } = getVersionInfo();

                await db.setConfig(config.tenantId, 'last_update_check', new Date().toISOString());

                if (latestVersion && isNewerVersion(latestVersion, currentVersion)) {
                    await db.setConfig(config.tenantId, 'last_known_latest_version', latestVersion);
                    logger.info(`Update available: v${latestVersion} (running v${currentVersion})`);
                } else {
                    await db.setConfig(config.tenantId, 'last_known_latest_version', currentVersion);
                }
            } catch (err) {
                // Fails silently on network error — never surfaced as an application error
                logger.debug('Update check failed', { error: err.message });
            }
        };

        // Run once at startup, then daily at 04:00 (Israel time)
        runCheck();
        cron.schedule('0 4 * * *', runCheck, { scheduled: true, timezone: 'Asia/Jerusalem' });
    }

    /**
     * Stop-gap self-diagnostics: hourly, reads new lines from error.log since the last run,
     * asks Gemini to summarize/de-duplicate them, and sends a WhatsApp digest if anything new turned up.
     */
    _scheduleSelfDiagnostics() {
        cron.schedule('0 * * * *', async () => {
            const profiles = await db.getEnabledProfiles();
            for (const profile of profiles) {
                await tenantContext.run(profile.tenant_id, () => this._runSelfDiagnosticsTick());
            }
        }, { scheduled: true, timezone: 'Asia/Jerusalem' });
    }

    async _runSelfDiagnosticsTick() {
        const tenantId = tenantContext.getTenantId();
        try {
            if (!config.whatsapp.groupId) return;

            const errorLogPath = path.resolve(process.cwd(), 'data', 'logs', 'error.log');

            let exists = false;
            try {
                await fs.promises.access(errorLogPath);
                exists = true;
            } catch {}
            if (!exists) return;

            const lines = await readLastLines(errorLogPath, 200);
            if (lines.length === 0) return;

            // Marker must be stored wrapped in an object, not as a bare string. error.log
            // lines are themselves JSON text, and db.getConfig() JSON.parses string values
            // on read — a bare marker string would silently come back as a parsed object,
            // which would never match against `lines` (an array of strings) below.
            const storedMarker = await db.getConfig(tenantId, 'last_diagnostics_marker', null);
            const marker = storedMarker && typeof storedMarker.line === 'string' ? storedMarker.line : null;

            let newLines = [];
            if (marker !== null) {
                const idx = lines.lastIndexOf(marker);
                newLines = idx === -1 ? lines : lines.slice(idx + 1);
            }
            // Always advance the marker so the same lines aren't re-sent next hour
            await db.setConfig(tenantId, 'last_diagnostics_marker', { line: lines[lines.length - 1] });

            if (newLines.length === 0) return;

            const { default: whatsappManager } = await import('./WhatsAppManager.js');
            if (!whatsappManager.isReady) return;

            let instruction = 'Summarize and de-duplicate these system error log lines into a short, clear Hebrew message for the admin. Group similar/repeated errors together instead of listing each one.';
            if (config.behaviorEngine === 'markdown') {
                const skillFile = await memoryManager.readFile(tenantId, 'skills', 'self_diagnostics.md');
                if (skillFile.success) {
                    instruction = skillFile.content;
                } else {
                    logger.warn('[SchedulerManager] BEHAVIOR_ENGINE=markdown but self_diagnostics.md skill not found for tenant; falling back to built-in instruction', { tenantId });
                }
            }

            const eventData = {
                event: 'Self-Diagnostics: New System Errors',
                data: {
                    error_count: newLines.length,
                    errors: newLines.slice(-10),
                    instruction
                }
            };

            const digest = await this.geminiManager.generateBroadcastMessage(eventData);
            if (digest && digest.trim()) {
                await whatsappManager.sendMessage(config.whatsapp.groupId, digest);
                logger.info('Self-diagnostics digest sent', { tenantId, newErrorCount: newLines.length });
            }
        } catch (err) {
            logger.error('Failed to run self-diagnostics', { tenantId, error: err.message });
        }
    }
}

export default new SchedulerManager();
export { SchedulerManager };
