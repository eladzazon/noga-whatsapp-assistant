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
    _knowledgeDir(tenantId) {
        return path.resolve(process.cwd(), 'data', 'knowledge', tenantId);
    }

    _skillsDir(tenantId) {
        return path.resolve(process.cwd(), 'data', 'skills', tenantId);
    }

    async init(tenantId) {
        await this._migrateFlatToTenantDir(tenantId);

        const knowledgeDir = this._knowledgeDir(tenantId);
        const skillsDir = this._skillsDir(tenantId);

        if (!(await exists(knowledgeDir))) {
            await fs.promises.mkdir(knowledgeDir, { recursive: true });
        }
        if (!(await exists(skillsDir))) {
            await fs.promises.mkdir(skillsDir, { recursive: true });
        }

        // Copy defaults if directories are empty
        const defaultsBase = path.resolve(process.cwd(), 'data_defaults');
        const dirsToCheck = [
            { path: knowledgeDir, defaultPath: path.join(defaultsBase, 'knowledge') },
            { path: skillsDir, defaultPath: path.join(defaultsBase, 'skills') }
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

        logger.info('MemoryManager initialized', { tenantId });
        return this;
    }

    /**
     * Block 3: knowledge/skill files moved from the flat data/knowledge|skills layout to
     * data/knowledge|skills/{tenant_id}. If the flat layout still has files and the tenant
     * directory doesn't exist yet, move (not copy) them so existing edits aren't lost or
     * re-clobbered by data_defaults.
     */
    async _migrateFlatToTenantDir(tenantId) {
        const flatDirs = [
            { flat: path.resolve(process.cwd(), 'data', 'knowledge'), tenant: this._knowledgeDir(tenantId) },
            { flat: path.resolve(process.cwd(), 'data', 'skills'), tenant: this._skillsDir(tenantId) }
        ];

        for (const { flat, tenant } of flatDirs) {
            if (await exists(tenant)) continue; // already migrated
            if (!(await exists(flat))) continue;

            const entries = await fs.promises.readdir(flat, { withFileTypes: true });
            const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
            if (mdFiles.length === 0) continue;

            await fs.promises.mkdir(tenant, { recursive: true });
            for (const entry of mdFiles) {
                await fs.promises.rename(path.join(flat, entry.name), path.join(tenant, entry.name));
            }
            logger.info('[MemoryManager] Migrated flat knowledge/skills files into tenant directory', {
                from: flat, to: tenant, count: mdFiles.length
            });
        }
    }

    async readKnowledgeFile(tenantId, filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this._knowledgeDir(tenantId), filename);
        if (await exists(filePath)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return { success: true, content };
        }
        return { success: false, error: `File ${filename} not found` };
    }

    async writeKnowledgeFile(tenantId, filename, content) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this._knowledgeDir(tenantId), filename);
        try {
            await fs.promises.writeFile(filePath, content, 'utf-8');
            logger.info('Knowledge file updated', { tenantId, filename });
            return { success: true, message: `Successfully updated ${filename}` };
        } catch (err) {
            logger.error('Failed to write knowledge file', { tenantId, filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    async createSkill(tenantId, skillName, instructions) {
        if (!skillName.endsWith('.md')) skillName += '.md';
        const filePath = path.join(this._skillsDir(tenantId), skillName);
        try {
            await fs.promises.writeFile(filePath, instructions, 'utf-8');
            logger.info('Skill created', { tenantId, skillName });
            return { success: true, message: `Successfully created skill: ${skillName}` };
        } catch (err) {
            logger.error('Failed to create skill file', { tenantId, skillName, error: err.message });
            return { success: false, error: err.message };
        }
    }

    async getKnowledgeFiles(tenantId) {
        const dir = this._knowledgeDir(tenantId);
        if (!(await exists(dir))) return [];
        const files = await fs.promises.readdir(dir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        return Promise.all(mdFiles.map(async f => {
            const content = await fs.promises.readFile(path.join(dir, f), 'utf-8');
            return { name: f, content };
        }));
    }

    async getSkillFiles(tenantId) {
        const dir = this._skillsDir(tenantId);
        if (!(await exists(dir))) return [];
        const files = await fs.promises.readdir(dir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        return Promise.all(mdFiles.map(async f => {
            const content = await fs.promises.readFile(path.join(dir, f), 'utf-8');
            return { name: f, content };
        }));
    }

    async deleteKnowledgeFile(tenantId, filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this._knowledgeDir(tenantId), filename);
        try {
            if (await exists(filePath)) {
                await fs.promises.unlink(filePath);
                logger.info('Knowledge file deleted', { tenantId, filename });
                return { success: true, message: `Successfully deleted ${filename}` };
            }
            return { success: false, error: `File ${filename} not found` };
        } catch (err) {
            logger.error('Failed to delete knowledge file', { tenantId, filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    async deleteSkill(tenantId, filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const filePath = path.join(this._skillsDir(tenantId), filename);
        try {
            if (await exists(filePath)) {
                await fs.promises.unlink(filePath);
                logger.info('Skill file deleted', { tenantId, filename });
                return { success: true, message: `Successfully deleted ${filename}` };
            }
            return { success: false, error: `File ${filename} not found` };
        } catch (err) {
            logger.error('Failed to delete skill file', { tenantId, filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    // ==================== Block 3 generic primitives ====================
    // Thin, kind-agnostic file I/O over the same two directories, for the markdown-mode
    // read_file/write_file/search_files tool primitives. Legacy mode keeps using the
    // knowledge/skill-specific methods above unchanged.

    async readFile(tenantId, kind, filename) {
        if (!filename.endsWith('.md')) filename += '.md';
        const dir = kind === 'skills' ? this._skillsDir(tenantId) : this._knowledgeDir(tenantId);
        const filePath = path.join(dir, filename);
        if (await exists(filePath)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return { success: true, content };
        }
        return { success: false, error: `File ${filename} not found in ${kind}` };
    }

    async writeFile(tenantId, kind, filename, content) {
        if (!filename.endsWith('.md')) filename += '.md';
        const dir = kind === 'skills' ? this._skillsDir(tenantId) : this._knowledgeDir(tenantId);
        try {
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(path.join(dir, filename), content, 'utf-8');
            logger.info('File written', { tenantId, kind, filename });
            return { success: true, message: `Successfully wrote ${kind}/${filename}` };
        } catch (err) {
            logger.error('Failed to write file', { tenantId, kind, filename, error: err.message });
            return { success: false, error: err.message };
        }
    }

    /**
     * Case-insensitive filename substring search across both knowledge and skill files.
     */
    async searchFiles(tenantId, query) {
        const q = (query || '').toLowerCase();
        const [knowledge, skills] = await Promise.all([
            this.getKnowledgeFiles(tenantId),
            this.getSkillFiles(tenantId)
        ]);
        const matches = [
            ...knowledge.filter(f => f.name.toLowerCase().includes(q)).map(f => ({ kind: 'knowledge', name: f.name })),
            ...skills.filter(f => f.name.toLowerCase().includes(q)).map(f => ({ kind: 'skills', name: f.name }))
        ];
        return { success: true, count: matches.length, matches };
    }

    async getStatus(tenantId) {
        const kFiles = await this.getKnowledgeFiles(tenantId);
        const sFiles = await this.getSkillFiles(tenantId);
        return {
            knowledgeFiles: kFiles.length,
            skillFiles: sFiles.length
        };
    }
}

export default new MemoryManager();
