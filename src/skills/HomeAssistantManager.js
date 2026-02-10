import axios from 'axios';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

class HomeAssistantManager {
    constructor() {
        this.client = null;
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

        this.client = axios.create({
            baseURL: `${this.baseUrl}/api`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        // Test connection
        try {
            const response = await this.client.get('/');
            logger.info('Home Assistant connected', { message: response.data.message });
        } catch (err) {
            logger.error('Failed to connect to Home Assistant', { error: err.message });
            this.client = null;
        }

        return this;
    }

    /**
     * Check if Home Assistant is available
     */
    isAvailable() {
        return !!this.client;
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
     * Get state of a specific entity
     * @param {string} entityId - Entity ID
     */
    async getState(entityId) {
        if (!this.isAvailable()) {
            return { error: 'Home Assistant not available' };
        }

        try {
            const response = await this.client.get(`/states/${entityId}`);

            return {
                success: true,
                entity: {
                    id: response.data.entity_id,
                    state: response.data.state,
                    name: response.data.attributes.friendly_name || entityId,
                    attributes: response.data.attributes,
                    lastChanged: response.data.last_changed
                }
            };
        } catch (err) {
            logger.error('Failed to get entity state', { error: err.message, entityId });
            return { error: err.message };
        }
    }

    /**
     * Turn on an entity
     * @param {string} entityId - Entity ID
     */
    async turnOn(entityId) {
        return this._callService(entityId, 'turn_on');
    }

    /**
     * Turn off an entity
     * @param {string} entityId - Entity ID
     */
    async turnOff(entityId) {
        return this._callService(entityId, 'turn_off');
    }

    /**
     * Toggle an entity
     * @param {string} entityId - Entity ID
     */
    async toggle(entityId) {
        return this._callService(entityId, 'toggle');
    }

    /**
     * Call a service on an entity
     * @param {string} entityId - Entity ID
     * @param {string} action - Service action
     * @param {Object} data - Additional service data
     */
    async _callService(entityId, action, data = {}) {
        if (!this.isAvailable()) {
            return { error: 'Home Assistant not available' };
        }

        try {
            const domain = entityId.split('.')[0];
            const endpoint = `/services/${domain}/${action}`;
            const payload = {
                entity_id: entityId,
                ...data
            };

            logger.info('Calling HA service', {
                endpoint,
                entityId,
                action,
                domain,
                payload: JSON.stringify(payload)
            });

            const response = await this.client.post(endpoint, payload);

            logger.info('HA service response', {
                entityId,
                action,
                status: response.status,
                dataLength: response.data ? response.data.length : 0,
                data: JSON.stringify(response.data).substring(0, 200)
            });

            // Verify the state changed by getting the new state
            const newState = await this.getState(entityId);

            return {
                success: true,
                entityId,
                action,
                newState: newState.entity ? newState.entity.state : 'unknown',
                result: response.data
            };
        } catch (err) {
            logger.error('Failed to call HA service', {
                error: err.message,
                entityId,
                action,
                responseData: err.response?.data,
                responseStatus: err.response?.status
            });
            return {
                success: false,
                error: err.message,
                details: err.response?.data
            };
        }
    }

    /**
     * Set light brightness
     * @param {string} entityId - Light entity ID
     * @param {number} brightness - Brightness (0-255) or percentage (0-100)
     */
    async setBrightness(entityId, brightness) {
        // Convert percentage to 0-255 if needed
        const brightnessValue = brightness <= 100 ? Math.round(brightness * 2.55) : brightness;

        return this._callService(entityId, 'turn_on', { brightness: brightnessValue });
    }

    /**
     * Set light color
     * @param {string} entityId - Light entity ID
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     */
    async setColor(entityId, rgbColor) {
        return this._callService(entityId, 'turn_on', { rgb_color: rgbColor });
    }

    /**
     * Get sensor reading with friendly formatting
     * @param {string} entityId - Sensor entity ID
     */
    async getSensorReading(entityId) {
        const result = await this.getState(entityId);

        if (result.error) return result;

        const { state, attributes, name } = result.entity;
        const unit = attributes.unit_of_measurement || '';

        return {
            success: true,
            name,
            value: state,
            unit,
            formatted: `${state}${unit}`
        };
    }

    /**
     * Find entity by name (fuzzy match)
     * @param {string} name - Entity name to search
     * @param {string} domain - Optional domain filter
     */
    async findEntityByName(name, domain = null) {
        logger.info('Finding entity by name', { name, domain });

        const result = domain
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

        // Log what we found
        logger.info('Entity search results', {
            searchTerm: name,
            matchCount: matches.length,
            matches: matches.map(m => ({ id: m.id, name: m.name })).slice(0, 5)
        });

        if (matches.length === 0) {
            return {
                success: false,
                message: `לא מצאתי מכשיר בשם "${name}". נסה לחפש עם שם אחר או השתמש ב-list_devices לראות את כל המכשירים.`
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
