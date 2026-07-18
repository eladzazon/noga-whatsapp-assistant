import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import config from '../../utils/config.js';
import memoryManager from '../../skills/MemoryManager.js';

export default function createKnowledgeRoutes(deps) {
    const router = Router();
    const { requireAuth, logger, server } = deps;

    // ==================== Knowledge Base API ====================

    // Get all knowledge files
    router.get('/api/knowledge', requireAuth, asyncHandler(async (req, res) => {
        const files = await memoryManager.getKnowledgeFiles(config.tenantId);
        res.json({ files });
    }));

    // Save knowledge file
    router.put('/api/knowledge/:filename', requireAuth, asyncHandler(async (req, res) => {
        const { filename } = req.params;
        const { content } = req.body;
        if (!content && content !== '') {
            return res.status(400).json({ error: 'Content is required' });
        }

        await memoryManager.writeKnowledgeFile(config.tenantId, filename, content);

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
        await memoryManager.deleteKnowledgeFile(config.tenantId, filename);

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
        const files = await memoryManager.getSkillFiles(config.tenantId);
        res.json({ files });
    }));

    // Save skill file
    router.put('/api/skills/:filename', requireAuth, asyncHandler(async (req, res) => {
        const { filename } = req.params;
        const { content } = req.body;
        if (!content && content !== '') {
            return res.status(400).json({ error: 'Content is required' });
        }

        await memoryManager.createSkill(config.tenantId, filename, content);

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
        await memoryManager.deleteSkill(config.tenantId, filename);

        // Re-initialize Gemini model
        if (server.geminiManager) {
            await server.geminiManager.reinit();
        }

        logger.info('Skill file deleted via dashboard', { filename });
        res.json({ success: true });
    }));

    return router;
}
