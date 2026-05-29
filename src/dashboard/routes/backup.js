import { Router } from 'express';
import express from 'express';
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

export default function createBackupRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, server } = deps;

    const getBackupsDir = () => path.resolve(process.cwd(), 'data', 'backups');

    router.post('/api/restore', requireAuth, express.json({limit: '10mb'}), asyncHandler(async (req, res) => {
        const { knowledge, skills, keywords, ha_mappings, scheduled_prompts, reminders, settings } = req.body;
        if (!knowledge && !skills && !keywords && !ha_mappings && !scheduled_prompts && !reminders && !settings) {
            const err = new Error('Invalid backup format');
            err.statusCode = 400;
            throw err;
        }

        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');

        // Restore MD files
        if (knowledge) {
            if (!(await exists(knowledgeDir))) {
                await fs.promises.mkdir(knowledgeDir, { recursive: true });
            }
            await Promise.all(
                Object.entries(knowledge).map(async ([file, content]) => {
                    if (file.endsWith('.md')) {
                        await fs.promises.writeFile(path.join(knowledgeDir, file), content, 'utf8');
                    }
                })
            );
        }
        if (skills) {
            if (!(await exists(skillsDir))) {
                await fs.promises.mkdir(skillsDir, { recursive: true });
            }
            await Promise.all(
                Object.entries(skills).map(async ([file, content]) => {
                    if (file.endsWith('.md')) {
                        await fs.promises.writeFile(path.join(skillsDir, file), content, 'utf8');
                    }
                })
            );
        }

        // Restore DB-backed data
        if (db) {
            if (keywords && Array.isArray(keywords)) {
                // Clear existing keywords and re-insert
                db.db.exec('DELETE FROM keywords');
                for (const k of keywords) {
                    try { db.addKeyword(k.keyword, k.response, k.type || 'static'); } catch { /* skip duplicates */ }
                }
                logger.info('Restored keywords', { count: keywords.length });
            }

            if (ha_mappings && Array.isArray(ha_mappings)) {
                db.db.exec('DELETE FROM ha_mappings');
                for (const m of ha_mappings) {
                    try { db.addHaMapping(m.entity_id, m.nickname, m.location, m.type); } catch { /* skip duplicates */ }
                }
                logger.info('Restored HA mappings', { count: ha_mappings.length });
            }

            if (scheduled_prompts && Array.isArray(scheduled_prompts)) {
                db.db.exec('DELETE FROM scheduled_prompts');
                for (const p of scheduled_prompts) {
                    try { db.addScheduledPrompt(p.name, p.prompt, p.cron_expression, p.enabled); } catch { /* skip */ }
                }
                logger.info('Restored scheduled prompts', { count: scheduled_prompts.length });
            }

            if (reminders && Array.isArray(reminders)) {
                db.db.exec('DELETE FROM reminders');
                const stmt = db.db.prepare("UPDATE reminders SET last_nudged = ?, nudge_count = ?, created_at = ?, updated_at = ? WHERE id = ?");
                for (const r of reminders) {
                    try { 
                        const id = db.addReminder(r.title, r.due_date, r.nudge_interval_minutes);
                        db.updateReminderStatus(id, r.status);
                        stmt.run(r.last_nudged, r.nudge_count || 0, r.created_at, r.updated_at, id);
                    } catch { /* skip */ }
                }
                logger.info('Restored reminders', { count: reminders.length });
            }

            if (settings && typeof settings === 'object') {
                const ENV_PREFIX = 'env_';
                for (const [key, value] of Object.entries(settings)) {
                    db.setConfig(`${ENV_PREFIX}${key}`, value);
                }
                logger.info('Restored settings', { count: Object.keys(settings).length });
            }
        }

        // Notify UI to refresh
        if (server.io) {
            server.io.emit('file_changed', { type: 'knowledge' });
            server.io.emit('file_changed', { type: 'skills' });
        }

        // Re-initialize Gemini with updated files
        if (server.geminiManager) {
            await server.geminiManager.reinit();
        }

        res.json({ success: true, message: 'Full system backup restored successfully' });
    }));

    // ---- Backup Management API ----

    // GET /api/backups — list all saved backups
    router.get('/api/backups', requireAuth, asyncHandler(async (req, res) => {
        const backupsDir = getBackupsDir();
        if (!(await exists(backupsDir))) {
            return res.json({ backups: [] });
        }

        const files = await fs.promises.readdir(backupsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        const backups = await Promise.all(
            jsonFiles.map(async f => {
                const stat = await fs.promises.stat(path.join(backupsDir, f));
                return { filename: f, size: stat.size, created_at: stat.mtime.toISOString() };
            })
        );

        // Sort newest first
        backups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json({ backups });
    }));

    // POST /api/backups/create — create a new backup now
    router.post('/api/backups/create', requireAuth, asyncHandler(async (req, res) => {
        const backupsDir = getBackupsDir();
        if (!(await exists(backupsDir))) {
            await fs.promises.mkdir(backupsDir, { recursive: true });
        }

        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        const backup = {
            version: 2,
            generated_at: new Date().toISOString(),
            knowledge: {}, skills: {}, keywords: [],
            ha_mappings: [], scheduled_prompts: [], reminders: [], settings: {}
        };

        if (await exists(knowledgeDir)) {
            const files = await fs.promises.readdir(knowledgeDir);
            const mdFiles = files.filter(f => f.endsWith('.md'));
            await Promise.all(
                mdFiles.map(async f => {
                    backup.knowledge[f] = await fs.promises.readFile(path.join(knowledgeDir, f), 'utf8');
                })
            );
        }
        if (await exists(skillsDir)) {
            const files = await fs.promises.readdir(skillsDir);
            const mdFiles = files.filter(f => f.endsWith('.md'));
            await Promise.all(
                mdFiles.map(async f => {
                    backup.skills[f] = await fs.promises.readFile(path.join(skillsDir, f), 'utf8');
                })
            );
        }
        
        if (db) {
            backup.keywords = db.getKeywords().map(k => ({ keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled }));
            backup.ha_mappings = db.getHaMappings().map(m => ({ entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type }));
            backup.scheduled_prompts = db.getScheduledPrompts().map(p => ({ name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled }));
            backup.reminders = db.getAllReminders();
        }

        // Settings: .env baseline + DB overrides
        const envPath2 = path.resolve(process.cwd(), '.env');
        if (await exists(envPath2)) {
            const content = await fs.promises.readFile(envPath2, 'utf-8');
            content.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx === -1) return;
                backup.settings[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
            });
        }
        
        if (db) {
            const dbOverrides2 = db.getAllConfig();
            for (const [key, value] of Object.entries(dbOverrides2)) {
                if (key.startsWith('env_')) backup.settings[key.substring(4)] = value;
            }
        }

        // Timestamped filename with seconds to allow multiple per day
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `noga_backup_${ts}.json`;
        const backupPath = path.join(backupsDir, filename);
        await fs.promises.writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');

        // Enforce retention limit (0 means disabled)
        if (db) {
            const retentionVal = db.getConfig('backup_retention', 7);
            const retention = retentionVal !== null && retentionVal !== undefined ? parseInt(retentionVal) : 7;
            if (retention > 0) {
                const allFiles = await fs.promises.readdir(backupsDir);
                const jsonFiles = allFiles.filter(f => f.endsWith('.json')).sort(); // oldest first
                if (jsonFiles.length > retention) {
                    const filesToDelete = jsonFiles.slice(0, jsonFiles.length - retention);
                    for (const old of filesToDelete) {
                        await fs.promises.unlink(path.join(backupsDir, old));
                        logger.info('Auto-deleted old backup', { file: old });
                    }
                }
            }
        }

        logger.info('Manual backup created', { filename });
        res.json({ success: true, filename });
    }));

    // GET /api/backups/:filename/download — download a specific backup
    router.get('/api/backups/:filename/download', requireAuth, asyncHandler(async (req, res) => {
        const filename = path.basename(req.params.filename); // sanitize
        if (!filename.endsWith('.json')) {
            const err = new Error('Invalid filename');
            err.statusCode = 400;
            throw err;
        }
        const filePath = path.join(getBackupsDir(), filename);
        if (!(await exists(filePath))) {
            const err = new Error('Backup not found');
            err.statusCode = 404;
            throw err;
        }
        res.setHeader('Content-disposition', `attachment; filename=${filename}`);
        res.setHeader('Content-type', 'application/json');
        fs.createReadStream(filePath).pipe(res);
    }));

    // DELETE /api/backups/:filename — delete a specific backup
    router.delete('/api/backups/:filename', requireAuth, asyncHandler(async (req, res) => {
        const filename = path.basename(req.params.filename);
        if (!filename.endsWith('.json')) {
            const err = new Error('Invalid filename');
            err.statusCode = 400;
            throw err;
        }
        const filePath = path.join(getBackupsDir(), filename);
        if (!(await exists(filePath))) {
            const err = new Error('Backup not found');
            err.statusCode = 404;
            throw err;
        }
        await fs.promises.unlink(filePath);
        logger.info('Backup deleted', { filename });
        res.json({ success: true });
    }));

    // GET /api/backup-settings — get retention setting
    router.get('/api/backup-settings', requireAuth, asyncHandler(async (req, res) => {
        const retentionVal = db ? db.getConfig('backup_retention', 7) : 7;
        const retention = retentionVal !== null && retentionVal !== undefined ? parseInt(retentionVal) : 7;
        res.json({ retention });
    }));

    // POST /api/backup-settings — save retention setting
    router.post('/api/backup-settings', requireAuth, express.json(), asyncHandler(async (req, res) => {
        const retention = parseInt(req.body.retention);
        if (isNaN(retention) || retention < 0 || retention > 30) {
            const err = new Error('Retention must be between 0 and 30');
            err.statusCode = 400;
            throw err;
        }
        if (db) {
            db.setConfig('backup_retention', retention);
        }
        logger.info('Backup retention updated', { retention });
        res.json({ success: true, retention });
    }));

    return router;
}
