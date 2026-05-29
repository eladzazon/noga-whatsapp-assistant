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

export default function createKnowledgeRoutes(deps) {
    const router = Router();
    const { requireAuth, logger, server } = deps;

    // ==================== Knowledge Base API ====================

    // Get all knowledge files
    router.get('/api/knowledge', requireAuth, asyncHandler(async (req, res) => {
        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        if (!(await exists(knowledgeDir))) {
            return res.json({ files: [] });
        }
        
        const files = await fs.promises.readdir(knowledgeDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        const filesData = await Promise.all(
            mdFiles.map(async f => {
                const content = await fs.promises.readFile(path.join(knowledgeDir, f), 'utf-8');
                return { name: f, content };
            })
        );
        res.json({ files: filesData });
    }));

    // Save knowledge file
    router.put('/api/knowledge/:filename', requireAuth, asyncHandler(async (req, res) => {
        const { filename } = req.params;
        const { content } = req.body;
        if (!content && content !== '') {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        if (!(await exists(knowledgeDir))) {
            await fs.promises.mkdir(knowledgeDir, { recursive: true });
        }
        
        await fs.promises.writeFile(path.join(knowledgeDir, filename), content, 'utf-8');
        
        // Re-initialize Gemini model
        if (server.geminiManager) {
            await server.geminiManager.reinit();
        }
        
        logger.info('Knowledge file updated via dashboard', { filename });
        res.json({ success: true });
    }));

    // Delete knowledge file
    router.delete('/api/knowledge/:filename', requireAuth, asyncHandler(async (req, res) => {
        const { filename } = req.params;
        const filePath = path.resolve(process.cwd(), 'data', 'knowledge', filename);
        if (await exists(filePath)) {
            await fs.promises.unlink(filePath);
        }
        
        // Re-initialize Gemini model
        if (server.geminiManager) {
            await server.geminiManager.reinit();
        }
        
        logger.info('Knowledge file deleted via dashboard', { filename });
        res.json({ success: true });
    }));

    // ==================== Skills Library API ====================

    // Get all skill files
    router.get('/api/skills', requireAuth, asyncHandler(async (req, res) => {
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        if (!(await exists(skillsDir))) {
            return res.json({ files: [] });
        }
        
        const files = await fs.promises.readdir(skillsDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        const filesData = await Promise.all(
            mdFiles.map(async f => {
                const content = await fs.promises.readFile(path.join(skillsDir, f), 'utf-8');
                return { name: f, content };
            })
        );
        res.json({ files: filesData });
    }));

    // Save skill file
    router.put('/api/skills/:filename', requireAuth, asyncHandler(async (req, res) => {
        const { filename } = req.params;
        const { content } = req.body;
        if (!content && content !== '') {
            return res.status(400).json({ error: 'Content is required' });
        }
        
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        if (!(await exists(skillsDir))) {
            await fs.promises.mkdir(skillsDir, { recursive: true });
        }
        
        await fs.promises.writeFile(path.join(skillsDir, filename), content, 'utf-8');
        
        // Re-initialize Gemini model
        if (server.geminiManager) {
            await server.geminiManager.reinit();
        }
        
        logger.info('Skill file updated via dashboard', { filename });
        res.json({ success: true });
    }));

    // Delete skill file
    router.delete('/api/skills/:filename', requireAuth, asyncHandler(async (req, res) => {
        const { filename } = req.params;
        const filePath = path.resolve(process.cwd(), 'data', 'skills', filename);
        if (await exists(filePath)) {
            await fs.promises.unlink(filePath);
        }
        
        // Re-initialize Gemini model
        if (server.geminiManager) {
            await server.geminiManager.reinit();
        }
        
        logger.info('Skill file deleted via dashboard', { filename });
        res.json({ success: true });
    }));

    return router;
}
