import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

class PromptBuilder {
    constructor() {
        this._cachedPrompt = null;
    }

    /**
     * Build system prompt dynamically from Markdown files
     * @returns {string} The assembled system prompt
     */
    build() {
        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        
        // Base system prompt is ALWAYS included
        let promptParts = [config.gemini.systemPrompt];

        try {
            if (fs.existsSync(knowledgeDir)) {
                const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));
                for (const file of files) {
                    const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
                    promptParts.push(`--- BEGIN ${file} ---\n${content}\n--- END ${file} ---`);
                }
            }
        } catch (err) {
            logger.error('Failed to read knowledge files', { error: err.message });
        }

        try {
            if (fs.existsSync(skillsDir)) {
                const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
                if (files.length > 0) {
                    let skillsList = "--- BEGIN AVAILABLE SKILLS ---\nThese are the skills you know how to execute. You can use these procedures if asked.\n\n";
                    for (const file of files) {
                        const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
                        skillsList += `Skill File: ${file}\n${content}\n\n`;
                    }
                    skillsList += "--- END AVAILABLE SKILLS ---";
                    promptParts.push(skillsList);
                }
            }
        } catch (err) {
            logger.error('Failed to read skills files', { error: err.message });
        }

        this._cachedPrompt = promptParts.join('\n\n');
        return this._cachedPrompt;
    }

    /**
     * Get the cached prompt (or build if not yet built)
     * @returns {string}
     */
    getPrompt() {
        if (!this._cachedPrompt) {
            return this.build();
        }
        return this._cachedPrompt;
    }
}

export default new PromptBuilder();
export { PromptBuilder };
