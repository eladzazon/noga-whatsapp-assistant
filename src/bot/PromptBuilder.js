import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
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

class PromptBuilder {
    constructor() {
        this._cachedPrompt = null;
    }

    /**
     * Build system prompt dynamically from Markdown files
     * @returns {Promise<string>} The assembled system prompt
     */
    async build() {
        const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
        const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
        
        // Base system prompt is ALWAYS included
        let promptParts = [config.gemini.systemPrompt];

        try {
            if (await exists(knowledgeDir)) {
                const files = await fs.promises.readdir(knowledgeDir);
                const mdFiles = files.filter(f => f.endsWith('.md'));
                
                const contents = await Promise.all(
                    mdFiles.map(async file => {
                        const content = await fs.promises.readFile(path.join(knowledgeDir, file), 'utf-8');
                        return `--- BEGIN ${file} ---\n${content}\n--- END ${file} ---`;
                    })
                );
                promptParts.push(...contents);
            }
        } catch (err) {
            logger.error('Failed to read knowledge files', { error: err.message });
        }

        try {
            if (await exists(skillsDir)) {
                const files = await fs.promises.readdir(skillsDir);
                const mdFiles = files.filter(f => f.endsWith('.md'));
                if (mdFiles.length > 0) {
                    let skillsList = "--- BEGIN AVAILABLE SKILLS ---\nThese are the skills you know how to execute. You can use these procedures if asked.\n\n";
                    
                    const contents = await Promise.all(
                        mdFiles.map(async file => {
                            const content = await fs.promises.readFile(path.join(skillsDir, file), 'utf-8');
                            return `Skill File: ${file}\n${content}\n\n`;
                        })
                    );
                    skillsList += contents.join('');
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
