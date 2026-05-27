import axios from 'axios';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

class HomeAssistantManager {
    constructor() {
        this.client = null; // Axios client (for fallback/finding entities)
        this.mcpClient = null; // New MCP client
        this.baseUrl = null;
    }

    /**
     * Initialize Home Assistant client
     */
    async init() {
        const { url, token } = config.homeAssistant;

        if (!url || !token) {
            logger.warn('Home Assistant not configured');
            return this;
        }

        this.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash

        // Keep Axios for legacy fuzzy search
        this.client = axios.create({
            baseURL: `${this.baseUrl}/api`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        // Initialize MCP Client
        try {
            logger.info('Initializing Home Assistant MCP client...');
            
            const transport = new StreamableHTTPClientTransport(new URL(`${this.baseUrl}/api/mcp`), {
                requestInit: {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            });

            this.mcpClient = new Client({
                name: "noga-whatsapp-assistant",
                version: "1.0.0"
            }, {
                capabilities: {
                    prompts: {},
                    resources: {},
                    tools: {}
                }
            });

            await this.mcpClient.connect(transport);
            logger.info('Home Assistant MCP client connected successfully');
        } catch (err) {
            logger.error('Failed to connect to Home Assistant MCP server', { error: err.message });
            this.mcpClient = null;
        }

        return this;
    }

    /**
     * Check if Home Assistant MCP is available
     */
    isAvailable() {
        return !!this.mcpClient;
    }

    /**
     * Get the MCP Client instance
     */
    getMcpClient() {
        return this.mcpClient;
    }

    /**
     * Get all entities
     */
    async getEntities() {
        if (!this.isAvailable()) {
            return { error: 'Home Assistant not available' };
        }

        try {
            const response = await this.client.get('/states');

            const entities = response.data.map(entity => ({
                id: entity.entity_id,
                state: entity.state,
                name: entity.attributes.friendly_name || entity.entity_id,
                type: entity.entity_id.split('.')[0],
                attributes: entity.attributes
            }));

            logger.info('Entities retrieved', { count: entities.length });

            return {
                success: true,
                count: entities.length,
                entities
            };
        } catch (err) {
            logger.error('Failed to get entities', { error: err.message });
            return { error: err.message };
        }
    }

    /**
     * Get entities by domain (type)
     * @param {string} domain - Entity domain (light, switch, sensor, etc.)
     */
    async getEntitiesByDomain(domain) {
        const result = await this.getEntities();

        if (result.error) return result;

        const filtered = result.entities.filter(e => e.type === domain);
        return {
            success: true,
            count: filtered.length,
            entities: filtered
        };
    }

    /**
     * Find entity by name (fuzzy match)
     * @param {string} name - Entity name to search
     * @param {string} domain - Optional domain filter
     */
    async findEntityByName(name, domain = null) {
        logger.info('Finding entity by name', { name, domain });

        let result = domain
            ? await this.getEntitiesByDomain(domain)
            : await this.getEntities();

        if (result.error) return result;

        const searchLower = name.toLowerCase();

        // Split search into words for partial matching
        const searchWords = searchLower.split(/\s+/).filter(w => w.length > 1);

        // First try exact match
        let matches = result.entities.filter(entity =>
            entity.name.toLowerCase().includes(searchLower) ||
            entity.id.toLowerCase().includes(searchLower)
        );

        // If no exact match, try matching all words
        if (matches.length === 0 && searchWords.length > 1) {
            matches = result.entities.filter(entity => {
                const nameLower = entity.name.toLowerCase();
                const idLower = entity.id.toLowerCase();
                return searchWords.every(word =>
                    nameLower.includes(word) || idLower.includes(word)
                );
            });
        }

        // Fallback: If domain was provided but no matches found, try searching ALL entities
        if (matches.length === 0 && domain) {
            logger.info(`No matches found in domain ${domain}, falling back to all entities`);
            const allEntitiesResult = await this.getEntities();
            if (!allEntitiesResult.error) {
                result = allEntitiesResult;
                
                // Retry exact match on all entities
                matches = result.entities.filter(entity =>
                    entity.name.toLowerCase().includes(searchLower) ||
                    entity.id.toLowerCase().includes(searchLower)
                );

                // Retry all words match on all entities
                if (matches.length === 0 && searchWords.length > 1) {
                    matches = result.entities.filter(entity => {
                        const nameLower = entity.name.toLowerCase();
                        const idLower = entity.id.toLowerCase();
                        return searchWords.every(word =>
                            nameLower.includes(word) || idLower.includes(word)
                        );
                    });
                }
            }
        }

        // Log what we found
        logger.info('Entity search results', {
            searchTerm: name,
            matchCount: matches.length,
            matches: matches.map(m => ({ id: m.id, name: m.name })).slice(0, 5)
        });

        if (matches.length === 0) {
            return {
                success: false,
                message: `לא מצאתי התאמה מדויקת למכשיר בשם "${name}". הנה רשימה של המכשירים הקיימים, אנא בחר את המתאים ביותר לפי הבנתך הסמנטית ונסה שוב:`,
                suggestions: result.entities.map(e => ({ id: e.id, name: e.name }))
            };
        }

        return {
            success: true,
            count: matches.length,
            entities: matches
        };
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            available: this.isAvailable(),
            url: this.baseUrl
        };
    }
}

export default new HomeAssistantManager();
export { HomeAssistantManager };
