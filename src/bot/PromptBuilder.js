import config from '../utils/config.js';
import tenantContext from '../utils/tenantContext.js';
import logger from '../utils/logger.js';
import memoryManager from '../skills/MemoryManager.js';

const IDENTITY_FILENAME = 'identity.md';

class PromptBuilder {
    constructor() {
        this._cachedPrompt = null;
    }

    /**
     * Build system prompt dynamically from Markdown files
     * @returns {Promise<string>} The assembled system prompt
     */
    async build() {
        const tenantId = tenantContext.getTenantId();

        let knowledgeFiles = [];
        let skillFiles = [];
        try {
            knowledgeFiles = await memoryManager.getKnowledgeFiles(tenantId);
        } catch (err) {
            logger.error('Failed to read knowledge files', { error: err.message });
        }
        try {
            skillFiles = await memoryManager.getSkillFiles(tenantId);
        } catch (err) {
            logger.error('Failed to read skills files', { error: err.message });
        }

        let promptParts;
        if (config.behaviorEngine === 'markdown') {
            const identityFile = knowledgeFiles.find(f => f.name.toLowerCase() === IDENTITY_FILENAME);
            let base = config.gemini.systemPrompt;
            if (identityFile) {
                base = identityFile.content;
            } else {
                logger.warn('[PromptBuilder] BEHAVIOR_ENGINE=markdown but identity.md was not found for tenant; falling back to config.gemini.systemPrompt', { tenantId });
            }
            const otherKnowledge = knowledgeFiles.filter(f => f.name.toLowerCase() !== IDENTITY_FILENAME);
            promptParts = [base, ...otherKnowledge.map(f => this._wrapKnowledge(f))];
        } else {
            // legacy — unchanged behavior: fixed prompt + every knowledge file, always
            promptParts = [config.gemini.systemPrompt, ...knowledgeFiles.map(f => this._wrapKnowledge(f))];
        }

        if (skillFiles.length > 0) {
            let skillsList = "--- BEGIN AVAILABLE SKILLS ---\nThese are the skills you know how to execute. You can use these procedures if asked.\n\n";
            skillsList += skillFiles.map(f => `Skill File: ${f.name}\n${f.content}\n\n`).join('');
            skillsList += "--- END AVAILABLE SKILLS ---";
            promptParts.push(skillsList);
        }

        this._cachedPrompt = promptParts.join('\n\n');
        return this._cachedPrompt;
    }

    _wrapKnowledge(file) {
        return `--- BEGIN ${file.name} ---\n${file.content}\n--- END ${file.name} ---`;
    }

    /**
     * Get the cached prompt (or build if not yet built)
     * @returns {Promise<string>}
     */
    async getPrompt() {
        if (!this._cachedPrompt) {
            return await this.build();
        }
        return this._cachedPrompt;
    }
}

export default new PromptBuilder();
export { PromptBuilder };
