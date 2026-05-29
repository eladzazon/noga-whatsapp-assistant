import { Router } from 'express';
import fs from 'fs';
import path from 'path';

export default function createKnowledgeRoutes(deps) {
    const router = Router();
    const { requireAuth, logger, server } = deps;

    // ==================== Knowledge Base API ====================

    // Get all knowledge files
    router.get('/api/knowledge', requireAuth, (req, res) => {
        try {
            const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
            if (!fs.existsSync(knowledgeDir)) {
                return res.json({ files: [] });
            }
            const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md')).map(f => {
                const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf-8');
                return { name: f, content };
            });
            res.json({ files });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Save knowledge file
    router.put('/api/knowledge/:filename', requireAuth, (req, res) => {
        const { filename } = req.params;
        const { content } = req.body;
        if (!content && content !== '') {
            return res.status(400).json({ error: 'Content is required' });
        }
        try {
            const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
            if (!fs.existsSync(knowledgeDir)) {
                fs.mkdirSync(knowledgeDir, { recursive: true });
            }
            fs.writeFileSync(path.join(knowledgeDir, filename), content, 'utf-8');
            
            // Re-initialize Gemini model
            if (server.geminiManager) {
                server.geminiManager.reinit();
            }
            
            logger.info('Knowledge file updated via dashboard', { filename });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete knowledge file
    router.delete('/api/knowledge/:filename', requireAuth, (req, res) => {
        const { filename } = req.params;
        try {
            const filePath = path.resolve(process.cwd(), 'data', 'knowledge', filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            // Re-initialize Gemini model
            if (server.geminiManager) {
                server.geminiManager.reinit();
            }
            
            logger.info('Knowledge file deleted via dashboard', { filename });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==================== Skills Library API ====================

    // Get all skill files
    router.get('/api/skills', requireAuth, (req, res) => {
        try {
            const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
            if (!fs.existsSync(skillsDir)) {
                return res.json({ files: [] });
            }
            const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md')).map(f => {
                const content = fs.readFileSync(path.join(skillsDir, f), 'utf-8');
                return { name: f, content };
            });
            res.json({ files });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Save skill file
    router.put('/api/skills/:filename', requireAuth, (req, res) => {
        const { filename } = req.params;
        const { content } = req.body;
        if (!content && content !== '') {
            return res.status(400).json({ error: 'Content is required' });
        }
        try {
            const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
            if (!fs.existsSync(skillsDir)) {
                fs.mkdirSync(skillsDir, { recursive: true });
            }
            fs.writeFileSync(path.join(skillsDir, filename), content, 'utf-8');
            
            // Re-initialize Gemini model
            if (server.geminiManager) {
                server.geminiManager.reinit();
            }
            
            logger.info('Skill file updated via dashboard', { filename });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete skill file
    router.delete('/api/skills/:filename', requireAuth, (req, res) => {
        const { filename } = req.params;
        try {
            const filePath = path.resolve(process.cwd(), 'data', 'skills', filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            // Re-initialize Gemini model
            if (server.geminiManager) {
                server.geminiManager.reinit();
            }
            
            logger.info('Skill file deleted via dashboard', { filename });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
