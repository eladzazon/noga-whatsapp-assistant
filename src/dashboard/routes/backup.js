import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';

export default function createBackupRoutes(deps) {
    const router = Router();
    const { requireAuth, db, logger, server } = deps;

    const getBackupsDir = () => path.resolve(process.cwd(), 'data', 'backups');

    router.post('/api/restore', requireAuth, express.json({limit: '10mb'}), (req, res) => {
        try {
            const { knowledge, skills, keywords, ha_mappings, scheduled_prompts, reminders, settings } = req.body;
            if (!knowledge && !skills && !keywords && !ha_mappings && !scheduled_prompts && !reminders && !settings) {
                return res.status(400).json({ error: 'Invalid backup format' });
            }

            const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
            const skillsDir = path.resolve(process.cwd(), 'data', 'skills');

            // Restore MD files
            if (knowledge) {
                if (!fs.existsSync(knowledgeDir)) fs.mkdirSync(knowledgeDir, { recursive: true });
                for (const [file, content] of Object.entries(knowledge)) {
                    if (file.endsWith('.md')) {
                        fs.writeFileSync(path.join(knowledgeDir, file), content, 'utf8');
                    }
                }
            }
            if (skills) {
                if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
                for (const [file, content] of Object.entries(skills)) {
                    if (file.endsWith('.md')) {
                        fs.writeFileSync(path.join(skillsDir, file), content, 'utf8');
                    }
                }
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
                server.geminiManager.reinit();
            }

            res.json({ success: true, message: 'Full system backup restored successfully' });
        } catch (err) {
            logger.error('Failed to restore backup', { error: err.message });
            res.status(500).json({ error: 'Failed to restore backup' });
        }
    });

    // ---- Backup Management API ----

    // GET /api/backups — list all saved backups
    router.get('/api/backups', requireAuth, (req, res) => {
        try {
            const backupsDir = getBackupsDir();
            if (!fs.existsSync(backupsDir)) return res.json({ backups: [] });

            const files = fs.readdirSync(backupsDir)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    const stat = fs.statSync(path.join(backupsDir, f));
                    return { filename: f, size: stat.size, created_at: stat.mtime.toISOString() };
                })
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // newest first

            res.json({ backups: files });
        } catch (err) {
            logger.error('Failed to list backups', { error: err.message });
            res.status(500).json({ error: 'Failed to list backups' });
        }
    });

    // POST /api/backups/create — create a new backup now
    router.post('/api/backups/create', requireAuth, (req, res) => {
        try {
            const backupsDir = getBackupsDir();
            if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

            const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
            const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
            const backup = {
                version: 2,
                generated_at: new Date().toISOString(),
                knowledge: {}, skills: {}, keywords: [],
                ha_mappings: [], scheduled_prompts: [], reminders: [], settings: {}
            };

            if (fs.existsSync(knowledgeDir)) {
                fs.readdirSync(knowledgeDir).forEach(f => {
                    if (f.endsWith('.md')) backup.knowledge[f] = fs.readFileSync(path.join(knowledgeDir, f), 'utf8');
                });
            }
            if (fs.existsSync(skillsDir)) {
                fs.readdirSync(skillsDir).forEach(f => {
                    if (f.endsWith('.md')) backup.skills[f] = fs.readFileSync(path.join(skillsDir, f), 'utf8');
                });
            }
            backup.keywords = db.getKeywords().map(k => ({ keyword: k.keyword, response: k.response, type: k.type, enabled: k.enabled }));
            backup.ha_mappings = db.getHaMappings().map(m => ({ entity_id: m.entity_id, nickname: m.nickname, location: m.location, type: m.type }));
            backup.scheduled_prompts = db.getScheduledPrompts().map(p => ({ name: p.name, prompt: p.prompt, cron_expression: p.cron_expression, enabled: p.enabled }));
            backup.reminders = db.getAllReminders();

            // Settings: .env baseline + DB overrides
            const envPath2 = path.resolve(process.cwd(), '.env');
            if (fs.existsSync(envPath2)) {
                const content = fs.readFileSync(envPath2, 'utf-8');
                content.split('\n').forEach(line => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) return;
                    const eqIdx = trimmed.indexOf('=');
                    if (eqIdx === -1) return;
                    backup.settings[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
                });
            }
            const dbOverrides2 = db.getAllConfig();
            for (const [key, value] of Object.entries(dbOverrides2)) {
                if (key.startsWith('env_')) backup.settings[key.substring(4)] = value;
            }


            // Timestamped filename with seconds to allow multiple per day
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const filename = `noga_backup_${ts}.json`;
            const backupPath = path.join(backupsDir, filename);
            fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');

            // Enforce retention limit
            const retention = parseInt(db.getConfig('backup_retention', 7)) || 7;
            const allFiles = fs.readdirSync(backupsDir)
                .filter(f => f.endsWith('.json'))
                .sort(); // ascending = oldest first
            if (allFiles.length > retention) {
                allFiles.slice(0, allFiles.length - retention).forEach(old => {
                    fs.unlinkSync(path.join(backupsDir, old));
                    logger.info('Auto-deleted old backup', { file: old });
                });
            }

            logger.info('Manual backup created', { filename });
            res.json({ success: true, filename });
        } catch (err) {
            logger.error('Failed to create backup', { error: err.message });
            res.status(500).json({ error: 'Failed to create backup' });
        }
    });

    // GET /api/backups/:filename/download — download a specific backup
    router.get('/api/backups/:filename/download', requireAuth, (req, res) => {
        try {
            const filename = path.basename(req.params.filename); // sanitize
            if (!filename.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
            const filePath = path.join(getBackupsDir(), filename);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });
            res.setHeader('Content-disposition', `attachment; filename=${filename}`);
            res.setHeader('Content-type', 'application/json');
            fs.createReadStream(filePath).pipe(res);
        } catch (err) {
            res.status(500).json({ error: 'Failed to download backup' });
        }
    });

    // DELETE /api/backups/:filename — delete a specific backup
    router.delete('/api/backups/:filename', requireAuth, (req, res) => {
        try {
            const filename = path.basename(req.params.filename);
            if (!filename.endsWith('.json')) return res.status(400).json({ error: 'Invalid filename' });
            const filePath = path.join(getBackupsDir(), filename);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Backup not found' });
            fs.unlinkSync(filePath);
            logger.info('Backup deleted', { filename });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete backup' });
        }
    });

    // GET /api/backup-settings — get retention setting
    router.get('/api/backup-settings', requireAuth, (req, res) => {
        const retention = parseInt(db.getConfig('backup_retention', 7)) || 7;
        res.json({ retention });
    });

    // POST /api/backup-settings — save retention setting
    router.post('/api/backup-settings', requireAuth, express.json(), (req, res) => {
        try {
            const retention = parseInt(req.body.retention);
            if (isNaN(retention) || retention < 1 || retention > 30) {
                return res.status(400).json({ error: 'Retention must be between 1 and 30' });
            }
            db.setConfig('backup_retention', retention);
            logger.info('Backup retention updated', { retention });
            res.json({ success: true, retention });
        } catch (err) {
            res.status(500).json({ error: 'Failed to save backup settings' });
        }
    });

    return router;
}
