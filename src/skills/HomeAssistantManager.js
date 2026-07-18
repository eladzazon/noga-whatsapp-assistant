import axios from 'axios';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';
import tenantContext from '../utils/tenantContext.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Cache TTL: 30 seconds
const ENTITY_CACHE_TTL_MS = 30_000;

/**
 * One tenant's Home Assistant connection (MCP client + legacy axios fallback). Block 4 Phase 2:
 * previously a single process-wide singleton built from config.homeAssistant.*; now instantiated
 * per-tenant by HomeAssistantRegistry below, built from either config.homeAssistant.* (the
 * default tenant) or profiles.ha_url/ha_token (an approved tenant).
 */
class HomeAssistantManager {
    constructor(haUrl, haToken) {
        this.haUrl = haUrl;
        this.haToken = haToken;
        this.client = null; // Axios client (for fallback/finding entities)
        this.mcpClient = null; // New MCP client
        this.baseUrl = null;
        // In-memory entity cache
        this._entityCache = null;
        this._entityCacheTs = 0;
    }

    /**
     * Initialize Home Assistant client
     */
    async init() {
        const { haUrl: url, haToken: token } = this;

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
            logger.info('Initializing Home Assistant MCP client...', { baseUrl: this.baseUrl });

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
            logger.info('Home Assistant MCP client connected successfully', { baseUrl: this.baseUrl });
        } catch (err) {
            logger.error('Failed to connect to Home Assistant MCP server', { baseUrl: this.baseUrl, error: err.message });
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
     * Get all entities — results are cached for ENTITY_CACHE_TTL_MS milliseconds
     */
    async getEntities() {
        if (!this.isAvailable()) {
            return { error: 'Home Assistant not available' };
        }

        // Return cached result if still fresh
        const now = Date.now();
        if (this._entityCache && (now - this._entityCacheTs) < ENTITY_CACHE_TTL_MS) {
            return this._entityCache;
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

            const result = {
                success: true,
                count: entities.length,
                entities
            };

            // Store in cache
            this._entityCache = result;
            this._entityCacheTs = now;

            return result;
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
            // Limit suggestions to top 20 to avoid sending 1000+ entities to AI
            const suggestions = result.entities.slice(0, 20).map(e => ({ id: e.id, name: e.name }));
            return {
                success: false,
                message: `לא מצאתי התאמה מדויקת למכשיר בשם "${name}". הנה רשימה של המכשירים הקיימים, אנא בחר את המתאים ביותר לפי הבנתך הסמנטית ונסה שוב:`,
                suggestions
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

/**
 * Lazily creates and caches one HomeAssistantManager per tenant. The default tenant
 * (config.tenantId) uses config.homeAssistant.url/token exactly as before; any other
 * (approved) tenant uses its own profiles.ha_url/ha_token.
 *
 * Known Phase 2 limitation: Gemini's MCP tool declarations are still built once, globally, from
 * whichever tenant's HA connects first (see skills/index.js) — this registry makes each tool
 * CALL execute against the correct tenant's HA instance, but doesn't give each tenant its own
 * tailored tool list. A tenant whose HA exposes meaningfully different entities/domains than the
 * reference tenant may hit gaps. Properly solving that is closer to Block 5 (per-tenant
 * orchestrator) scope.
 */
class HomeAssistantRegistry {
    constructor() {
        this._instances = new Map(); // tenantId -> HomeAssistantManager
    }

    async _resolveCredentials(tenantId) {
        if (tenantId === config.tenantId) {
            return { haUrl: config.homeAssistant.url, haToken: config.homeAssistant.token };
        }
        const profile = await db.getProfileByTenantId(tenantId);
        return { haUrl: profile?.ha_url || null, haToken: profile?.ha_token || null };
    }

    async getForTenant(tenantId) {
        if (this._instances.has(tenantId)) {
            return this._instances.get(tenantId);
        }
        const { haUrl, haToken } = await this._resolveCredentials(tenantId);
        const manager = new HomeAssistantManager(haUrl, haToken);
        await manager.init();
        this._instances.set(tenantId, manager);
        return manager;
    }

    /** Resolve the HA connection for whichever tenant is bound to the current async context. */
    async getCurrent() {
        return this.getForTenant(tenantContext.getTenantId());
    }
}

export default new HomeAssistantRegistry();
export { HomeAssistantManager };
