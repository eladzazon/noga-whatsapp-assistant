import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * KnowledgeManager — Manages Noga's persistent knowledge base and skills.
 * 
 * Knowledge files (data/knowledge/*.md) are declarative memory — facts, preferences, rules.
 * Skill files (data/skills/*.md) are procedural memory — step-by-step workflows.
 * 
 * Both are plain Markdown files editable via the dashboard or by Noga herself.
 */
class KnowledgeManager {
    constructor() {
        this.knowledgePath = path.resolve(process.cwd(), 'data/knowledge');
        this.skillsPath = path.resolve(process.cwd(), 'data/skills');
        this._ensureDirectories();
    }

    /**
     * Ensure knowledge and skills directories exist
     */
    _ensureDirectories() {
        for (const dir of [this.knowledgePath, this.skillsPath]) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.info('Created directory', { path: dir });
            }
        }
    }

    // ==================== Knowledge Files ====================

    /**
     * List all knowledge files
     * @returns {Array<{name: string, filename: string, size: number, modified: string}>}
     */
    listKnowledgeFiles() {
        return this._listFiles(this.knowledgePath);
    }

    /**
     * Read a knowledge file
     * @param {string} filename - Filename (e.g., 'USER.md')
     * @returns {string} File content
     */
    readKnowledge(filename) {
        const filePath = this._safePath(this.knowledgePath, filename);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return fs.readFileSync(filePath, 'utf-8');
    }

    /**
     * Write/update a knowledge file
     * @param {string} filename - Filename (e.g., 'MEMORY.md')
     * @param {string} content - New file content
     */
    writeKnowledge(filename, content) {
        const filePath = this._safePath(this.knowledgePath, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        logger.info('Knowledge file updated', { filename, size: content.length });
    }

    /**
     * Append content to a knowledge file (useful for MEMORY.md)
     * @param {string} filename - Filename
     * @param {string} content - Content to append
     */
    appendKnowledge(filename, content) {
        const filePath = this._safePath(this.knowledgePath, filename);
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        const updated = existing.trimEnd() + '\n' + content + '\n';
        fs.writeFileSync(filePath, updated, 'utf-8');
        logger.info('Knowledge file appended', { filename, appendedLength: content.length });
    }

    /**
     * Delete a knowledge file
     * @param {string} filename - Filename
     */
    deleteKnowledge(filename) {
        const filePath = this._safePath(this.knowledgePath, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info('Knowledge file deleted', { filename });
        }
    }

    // ==================== Skills Files ====================

    /**
     * List all skill files
     * @returns {Array<{name: string, filename: string, size: number, modified: string}>}
     */
    listSkills() {
        return this._listFiles(this.skillsPath);
    }

    /**
     * Read a skill file
     * @param {string} filename - Skill filename
     * @returns {string|null} Skill content
     */
    readSkill(filename) {
        const filePath = this._safePath(this.skillsPath, filename);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        return fs.readFileSync(filePath, 'utf-8');
    }

    /**
     * Write/create a skill file
     * @param {string} filename - Skill filename (e.g., 'morning_routine.md')
     * @param {string} content - Skill content
     */
    writeSkill(filename, content) {
        const filePath = this._safePath(this.skillsPath, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        logger.info('Skill file written', { filename, size: content.length });
    }

    /**
     * Delete a skill file
     * @param {string} filename - Skill filename
     */
    deleteSkill(filename) {
        const filePath = this._safePath(this.skillsPath, filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info('Skill file deleted', { filename });
        }
    }

    // ==================== System Prompt Builder ====================

    /**
     * Build the full system prompt from knowledge files + skills summary.
     * This is the heart of the architecture — the prompt is dynamically assembled
     * from the Markdown files rather than being a static string.
     * 
     * @returns {string} The assembled system prompt
     */
    buildSystemPrompt() {
        const sections = [];

        // 1. Core identity
        const identity = this.readKnowledge('IDENTITY.md');
        if (identity) {
            sections.push(identity);
        }

        // 2. Tool execution rules
        const toolRules = this.readKnowledge('TOOL_RULES.md');
        if (toolRules) {
            sections.push(toolRules);
        }

        // 3. User profile
        const user = this.readKnowledge('USER.md');
        if (user && user.trim().length > 50) { // Only include if has real content
            sections.push(user);
        }

        // 4. Home environment
        const home = this.readKnowledge('HOME.md');
        if (home && home.trim().length > 50) {
            sections.push(home);
        }

        // 5. Memory
        const memory = this.readKnowledge('MEMORY.md');
        if (memory && memory.trim().length > 50) {
            sections.push(memory);
        }

        // 6. Any additional knowledge files (custom ones the user creates)
        const allFiles = this.listKnowledgeFiles();
        const coreFiles = ['IDENTITY.md', 'TOOL_RULES.md', 'USER.md', 'HOME.md', 'MEMORY.md'];
        for (const file of allFiles) {
            if (!coreFiles.includes(file.filename)) {
                const content = this.readKnowledge(file.filename);
                if (content && content.trim().length > 10) {
                    sections.push(`# ${file.filename}\n${content}`);
                }
            }
        }

        // 7. Available skills summary (so Noga knows what procedures she can follow)
        const skills = this.listSkills();
        if (skills.length > 0) {
            const skillSummary = skills.map(s => {
                const content = this.readSkill(s.filename);
                // Extract the first line (title) and the "מתי להפעיל" section
                const title = content?.split('\n')[0]?.replace(/^#+\s*/, '') || s.filename;
                const whenMatch = content?.match(/## מתי להפעיל\n([\s\S]*?)(?=\n##|$)/);
                const when = whenMatch ? whenMatch[1].trim() : '';
                return `- **${title}** (${s.filename}): ${when}`;
            }).join('\n');

            sections.push(`# 🛠️ כישורים זמינים (Skills)\nהכישורים הבאים זמינים לך. כשמתקיים התנאי, קרא את הקובץ המלא באמצעות read_knowledge ופעל לפיו.\n\n${skillSummary}`);
        }

        return sections.join('\n\n---\n\n');
    }

    // ==================== Agentic Tool Functions ====================

    /**
     * Tool handler: update_memory
     * Called by Gemini when Noga learns something new
     */
    handleUpdateMemory({ content, section }) {
        const now = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
        const entry = `- [${now}] ${content}`;

        if (section === 'user') {
            this.appendKnowledge('USER.md', entry);
            return { success: true, message: `Saved to USER.md: ${content}` };
        } else if (section === 'home') {
            this.appendKnowledge('HOME.md', entry);
            return { success: true, message: `Saved to HOME.md: ${content}` };
        } else {
            this.appendKnowledge('MEMORY.md', entry);
            return { success: true, message: `Saved to MEMORY.md: ${content}` };
        }
    }

    /**
     * Tool handler: read_knowledge
     * Called by Gemini when it needs to read a knowledge or skill file
     */
    handleReadKnowledge({ filename }) {
        // Check knowledge first, then skills
        let content = this.readKnowledge(filename);
        if (content === null) {
            content = this.readSkill(filename);
        }
        if (content === null) {
            return { success: false, error: `File not found: ${filename}` };
        }
        return { success: true, content };
    }

    /**
     * Tool handler: create_skill
     * Called by Gemini when it wants to learn a new reusable procedure
     */
    handleCreateSkill({ name, content }) {
        // Sanitize name to be filename-safe
        const filename = name.replace(/[^a-zA-Z0-9_\u0590-\u05FF-]/g, '_').toLowerCase() + '.md';
        this.writeSkill(filename, content);
        return { success: true, message: `Skill created: ${filename}`, filename };
    }

    // ==================== Helpers ====================

    /**
     * List Markdown files in a directory
     */
    _listFiles(dirPath) {
        if (!fs.existsSync(dirPath)) return [];

        return fs.readdirSync(dirPath)
            .filter(f => f.endsWith('.md'))
            .map(filename => {
                const filePath = path.join(dirPath, filename);
                const stats = fs.statSync(filePath);
                return {
                    name: filename.replace('.md', ''),
                    filename,
                    size: stats.size,
                    modified: stats.mtime.toISOString()
                };
            })
            .sort((a, b) => a.filename.localeCompare(b.filename));
    }

    /**
     * Prevent directory traversal attacks
     */
    _safePath(basePath, filename) {
        // Strip any path separators
        const safeName = path.basename(filename);
        return path.join(basePath, safeName);
    }
}

export default new KnowledgeManager();
export { KnowledgeManager };
