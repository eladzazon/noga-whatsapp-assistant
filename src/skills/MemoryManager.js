import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

// Helper to check file/dir existence asynchronously
async function exists(filePath) {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

class MemoryManager {
    constructor() {
        this.knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        this.skillsDir = path.resolve(process.cwd(), 'data', 'skills');
    }

    async init() {
        // Ensure directories exist
        if (!(await exists(this.knowledgeDir))) {
            await fs.promises.mkdir(this.knowledgeDir, { recursive: true });
        }
        if (!(await exists(this.skillsDir))) {
            await fs.promises.mkdir(this.skillsDir, { recursive: true });
        }
        
        // Copy defaults if directories are empty
        const defaultsBase = path.resolve(process.cwd(), 'data_defaults');
        const dirsToCheck = [
            { path: this.knowledgeDir, defaultPath: path.join(defaultsBase, 'knowledge') },
            { path: this.skillsDir, defaultPath: path.join(defaultsBase, 'skills') }
        ];

        for (const dirInfo of dirsToCheck) {
            if (await exists(dirInfo.defaultPath)) {
                const existingFiles = await fs.promises.readdir(dirInfo.path);
                if (existingFiles.length === 0) {
                    logger.info('Populating directory with defaults', { path: dirInfo.path });
                    const defaultFiles = await fs.promises.readdir(dirInfo.defaultPath);
                    for (const file of defaultFiles) {
                        const srcFile = path.join(dirInfo.defaultPath, file);
                        const destFile = path.join(dirInfo.path, file);
                        const stats = await fs.promises.stat(srcFile);
                        if (stats.isFile()) {
                            await fs.promises.copyFile(srcFile, destFile);
                        }
                    }
                }
            }
        }

        logger.info('MemoryManager initialized');
        return this;
    }

    async readKnowledgeFile(filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this.knowledgeDir, filename);
        if (await exists(filePath)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return { success: true, content };
        }
        return { success: false, error: `File ${filename} not found` };
    }

    async writeKnowledgeFile(filename, content) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this.knowledgeDir, filename);
        try {
            await fs.promises.writeFile(filePath, content, 'utf-8');
            logger.info('Knowledge file updated', { filename });
            return { success: true, message: `Successfully updated ${filename}` };
        } catch (err) {
            logger.error('Failed to write knowledge file', { filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    async createSkill(skillName, instructions) {
        if (!skillName.endsWith('.md')) skillName += '.md';
        const filePath = path.join(this.skillsDir, skillName);
        try {
            await fs.promises.writeFile(filePath, instructions, 'utf-8');
            logger.info('Skill created', { skillName });
            return { success: true, message: `Successfully created skill: ${skillName}` };
        } catch (err) {
            logger.error('Failed to create skill file', { skillName, error: err.message });
            return { success: false, error: err.message };
        }
    }

    async getKnowledgeFiles() {
        if (!(await exists(this.knowledgeDir))) return [];
        const files = await fs.promises.readdir(this.knowledgeDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        return Promise.all(mdFiles.map(async f => {
            const content = await fs.promises.readFile(path.join(this.knowledgeDir, f), 'utf-8');
            return { name: f, content };
        }));
    }

    async getSkillFiles() {
        if (!(await exists(this.skillsDir))) return [];
        const files = await fs.promises.readdir(this.skillsDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        return Promise.all(mdFiles.map(async f => {
            const content = await fs.promises.readFile(path.join(this.skillsDir, f), 'utf-8');
            return { name: f, content };
        }));
    }

    async deleteKnowledgeFile(filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this.knowledgeDir, filename);
        try {
            if (await exists(filePath)) {
                await fs.promises.unlink(filePath);
                logger.info('Knowledge file deleted', { filename });
                return { success: true, message: `Successfully deleted ${filename}` };
            }
            return { success: false, error: `File ${filename} not found` };
        } catch (err) {
            logger.error('Failed to delete knowledge file', { filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    async getStatus() {
        const kFiles = await this.getKnowledgeFiles();
        const sFiles = await this.getSkillFiles();
        return {
            knowledgeFiles: kFiles.length,
            skillFiles: sFiles.length
        };
    }
}

export default new MemoryManager();
