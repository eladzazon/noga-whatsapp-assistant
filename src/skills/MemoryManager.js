import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

class MemoryManager {
    constructor() {
        this.knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        this.skillsDir = path.resolve(process.cwd(), 'data', 'skills');
    }

    init() {
        // Ensure directories exist
        if (!fs.existsSync(this.knowledgeDir)) {
            fs.mkdirSync(this.knowledgeDir, { recursive: true });
        }
        if (!fs.existsSync(this.skillsDir)) {
            fs.mkdirSync(this.skillsDir, { recursive: true });
        }
        logger.info('MemoryManager initialized');
        return this;
    }

    readKnowledgeFile(filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this.knowledgeDir, filename);
        if (fs.existsSync(filePath)) {
            return { success: true, content: fs.readFileSync(filePath, 'utf-8') };
        }
        return { success: false, error: `File ${filename} not found` };
    }

    writeKnowledgeFile(filename, content) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this.knowledgeDir, filename);
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            logger.info('Knowledge file updated', { filename });
            return { success: true, message: `Successfully updated ${filename}` };
        } catch (err) {
            logger.error('Failed to write knowledge file', { filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    createSkill(skillName, instructions) {
        if (!skillName.endsWith('.md')) skillName += '.md';
        const filePath = path.join(this.skillsDir, skillName);
        try {
            fs.writeFileSync(filePath, instructions, 'utf-8');
            logger.info('Skill created', { skillName });
            return { success: true, message: `Successfully created skill: ${skillName}` };
        } catch (err) {
            logger.error('Failed to create skill file', { skillName, error: err.message });
            return { success: false, error: err.message };
        }
    }

    getKnowledgeFiles() {
        if (!fs.existsSync(this.knowledgeDir)) return [];
        return fs.readdirSync(this.knowledgeDir)
            .filter(f => f.endsWith('.md'))
            .map(f => ({
                name: f,
                content: fs.readFileSync(path.join(this.knowledgeDir, f), 'utf-8')
            }));
    }

    getSkillFiles() {
        if (!fs.existsSync(this.skillsDir)) return [];
        return fs.readdirSync(this.skillsDir)
            .filter(f => f.endsWith('.md'))
            .map(f => ({
                name: f,
                content: fs.readFileSync(path.join(this.skillsDir, f), 'utf-8')
            }));
    }

    deleteKnowledgeFile(filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this.knowledgeDir, filename);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info('Knowledge file deleted', { filename });
                return { success: true, message: `Successfully deleted ${filename}` };
            }
            return { success: false, error: `File ${filename} not found` };
        } catch (err) {
            logger.error('Failed to delete knowledge file', { filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    getStatus() {
        return {
            knowledgeFiles: this.getKnowledgeFiles().length,
            skillFiles: this.getSkillFiles().length
        };
    }
}

export default new MemoryManager();
