import calendarManager from './CalendarManager.js';
import homeAssistantManager from './HomeAssistantManager.js';
import memoryManager from './MemoryManager.js';
import db from '../database/DatabaseManager.js';
import { findActionAndEntity } from '../utils/HaRecognition.js';
import logger from '../utils/logger.js';

let globalGeminiManager = null;

export function setGeminiManager(manager) {
    globalGeminiManager = manager;
}

/**
 * Function declarations for Gemini Function Calling
 * These define what tools Gemini can use
 */
export const functionDeclarations = [
    // ==================== Calendar Functions ====================
    {
        name: 'list_calendar_events',
        description: 'רשימת אירועים מהיומן לטווח תאריכים. Get calendar events for a date range.',
        parameters: {
            type: 'object',
            properties: {
                start_date: {
                    type: 'string',
                    description: 'תאריך התחלה בפורמט YYYY-MM-DD. Start date in YYYY-MM-DD format.'
                },
                end_date: {
                    type: 'string',
                    description: 'תאריך סיום בפורמט YYYY-MM-DD (אופציונלי). End date in YYYY-MM-DD format (optional).'
                }
            },
            required: ['start_date']
        }
    },
    {
        name: 'add_calendar_event',
        description: 'הוסף אירוע חדש ליומן. Add a new event to the calendar.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'כותרת האירוע. Event title.'
                },
                date: {
                    type: 'string',
                    description: 'תאריך האירוע בפורמט YYYY-MM-DD. Event date in YYYY-MM-DD format.'
                },
                time: {
                    type: 'string',
                    description: 'שעת האירוע בפורמט HH:MM (אופציונלי). Event time in HH:MM format (optional).'
                },
                duration_minutes: {
                    type: 'number',
                    description: 'משך האירוע בדקות, ברירת מחדל 60. Duration in minutes, default 60.'
                },
                description: {
                    type: 'string',
                    description: 'תיאור האירוע (אופציונלי). Event description (optional).'
                }
            },
            required: ['title', 'date']
        }
    },

    // ==================== Shopping List Functions Removed (Now a Skill) ====================

    // ==================== Memory/Agentic Functions ====================
    {
        name: 'read_knowledge_file',
        description: 'Read the contents of a knowledge file (e.g., USER, HOME, MEMORY).',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'The name of the file to read (e.g., "MEMORY.md").'
                }
            },
            required: ['filename']
        }
    },
    {
        name: 'update_memory',
        description: 'Update the MEMORY.md file or any other knowledge file with new information.',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'The name of the file to update (usually "MEMORY.md").'
                },
                content: {
                    type: 'string',
                    description: 'The full new content to write to the file. You must include all previous important information and the new information.'
                }
            },
            required: ['filename', 'content']
        }
    },
    {
        name: 'create_skill',
        description: 'Create a new skill (procedure) that teaches you how to perform a multi-step task.',
        parameters: {
            type: 'object',
            properties: {
                skill_name: {
                    type: 'string',
                    description: 'The name of the skill file (e.g., "guest_wifi_procedure.md").'
                },
                instructions: {
                    type: 'string',
                    description: 'The step-by-step instructions in Markdown format.'
                }
            },
            required: ['skill_name', 'instructions']
        }
    },
    {
        name: 'list_memory',
        description: 'List all available knowledge and memory files.'
    },
    {
        name: 'delete_memory',
        description: 'Delete a knowledge or memory file.',
        parameters: {
            type: 'object',
            properties: {
                filename: {
                    type: 'string',
                    description: 'The name of the file to delete (e.g., "OLD_NOTES.md").'
                }
            },
            required: ['filename']
        }
    },
    // ==================== Home Assistant Functions ====================
    {
        name: 'control_device',
        description: 'שלוט במכשיר בבית חכם - הדלק, כבה או החלף מצב. Control a smart home device - turn on, off, or toggle.',
        parameters: {
            type: 'object',
            properties: {
                entity_id: {
                    type: 'string',
                    description: 'מזהה המכשיר (למשל light.living_room) או שם המכשיר. Entity ID or device name.'
                },
                action: {
                    type: 'string',
                    enum: ['turn_on', 'turn_off', 'toggle'],
                    description: 'הפעולה לביצוע. Action to perform.'
                }
            },
            required: ['entity_id', 'action']
        }
    },
    {
        name: 'get_device_state',
        description: 'קבל את מצב מכשיר בבית חכם (מודלק/כבוי, טמפרטורה וכו׳). Get smart home device state.',
        parameters: {
            type: 'object',
            properties: {
                entity_id: {
                    type: 'string',
                    description: 'מזהה המכשיר או החיישן. Entity ID or sensor.'
                }
            },
            required: ['entity_id']
        }
    },
    {
        name: 'list_devices',
        description: 'הצג רשימת מכשירים בבית החכם. List smart home devices.',
        parameters: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'סוג המכשירים (light, switch, sensor, climate). Device type filter.'
                }
            }
        }
    },
    {
        name: 'find_device',
        description: 'מצא מכשיר לפי שם. Find a device by name.',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'שם המכשיר לחיפוש. Device name to search.'
                },
                type: {
                    type: 'string',
                    description: 'סוג המכשיר (אופציונלי). Device type (optional).'
                }
            },
            required: ['name']
        }
    },
    {
        name: 'set_light_brightness',
        description: 'קבע עוצמת תאורה. Set light brightness.',
        parameters: {
            type: 'object',
            properties: {
                entity_id: {
                    type: 'string',
                    description: 'מזהה התאורה. Light entity ID.'
                },
                brightness: {
                    type: 'number',
                    description: 'עוצמה באחוזים (0-100). Brightness percentage (0-100).'
                }
            },
            required: ['entity_id', 'brightness']
        }
    }
];

/**
 * Helper to resolve an entity identifier (ID or friendly name) to a valid HA entity ID.
 * Prioritizes custom mappings from the database.
 * @param {string} identifier - The ID or name to resolve
 * @returns {Promise<string|Object>} - Resolved entity ID or error object
 */
async function resolveEntityId(identifier) {
    if (!identifier) return { error: 'No entity identifier provided' };

    // 1. Check if it's already a valid entity ID that exists in mappings
    // (This handles cases where Gemini uses the real ID)
    const exactMapping = db.getHaMappings().find(m => m.entity_id === identifier);
    if (exactMapping) return exactMapping.entity_id;

    // 2. Identify if it looks like a friendly name
    const looksLikeFriendlyName = !identifier.includes('.') ||
        /[A-Z]/.test(identifier) ||
        /\s/.test(identifier) ||
        /[\u0590-\u05FF]/.test(identifier);

    // 3. Check custom mappings by nickname/location
    const mappings = db.findHaMappingsByName(identifier);
    if (mappings.length > 0) {
        logger.info('Resolved entity via custom mappings', { original: identifier, resolved: mappings[0].entity_id });
        return mappings[0].entity_id;
    }

    // 4. If it looks like a friendly name, try native HA search
    if (looksLikeFriendlyName) {
        const result = await homeAssistantManager.findEntityByName(identifier);
        if (result.success && result.entities.length > 0) {
            logger.info('Resolved entity via HA native search', { original: identifier, resolved: result.entities[0].id });
            return result.entities[0].id;
        }
        return result; // Return the search failure result
    }

    // 5. Default: return as-is (assume it's a real entity ID)
    return identifier;
}

/**
 * Map function names to their handlers
 */
export const functionHandlers = {
    // ==================== Calendar Handlers ====================
    list_calendar_events: async (args) => {
        logger.info('Executing: list_calendar_events', args);
        return await calendarManager.listEvents(args.start_date, args.end_date);
    },

    add_calendar_event: async (args) => {
        logger.info('Executing: add_calendar_event', args);
        return await calendarManager.addEvent(
            args.title,
            args.date,
            args.time || null,
            args.duration_minutes || 60,
            args.description || ''
        );
    },

    // ==================== Shopping List Handlers Removed (Now a Skill) ====================

    // ==================== Memory Handlers ====================
    read_knowledge_file: async (args) => {
        logger.info('Executing: read_knowledge_file', args);
        return memoryManager.readKnowledgeFile(args.filename);
    },

    update_memory: async (args) => {
        logger.info('Executing: update_memory', args);
        const result = memoryManager.writeKnowledgeFile(args.filename, args.content);
        if (result.success && globalGeminiManager) {
            globalGeminiManager.reinit();
        }
        return result;
    },

    create_skill: async (args) => {
        logger.info('Executing: create_skill', args);
        const result = memoryManager.createSkill(args.skill_name, args.instructions);
        if (result.success && globalGeminiManager) {
            globalGeminiManager.reinit();
        }
        return result;
    },

    list_memory: async () => {
        logger.info('Executing: list_memory');
        const files = memoryManager.getKnowledgeFiles();
        return { success: true, files: files.map(f => f.name) };
    },

    delete_memory: async (args) => {
        logger.info('Executing: delete_memory', args);
        const result = memoryManager.deleteKnowledgeFile(args.filename);
        if (result.success && globalGeminiManager) {
            globalGeminiManager.reinit();
        }
        return result;
    },

    // ==================== Home Assistant Handlers ====================
    control_device: async (args) => {
        logger.info('Executing: control_device', args);

        const resolved = await resolveEntityId(args.entity_id);
        if (typeof resolved === 'object' && resolved.success === false) return resolved;
        if (typeof resolved === 'object' && resolved.error) return resolved;

        const entityId = resolved;

        switch (args.action) {
            case 'turn_on':
                return await homeAssistantManager.turnOn(entityId);
            case 'turn_off':
                return await homeAssistantManager.turnOff(entityId);
            case 'toggle':
                return await homeAssistantManager.toggle(entityId);
            default:
                return { error: `Unknown action: ${args.action}` };
        }
    },

    get_device_state: async (args) => {
        logger.info('Executing: get_device_state', args);

        const resolved = await resolveEntityId(args.entity_id);
        if (typeof resolved === 'object' && resolved.success === false) return resolved;
        if (typeof resolved === 'object' && resolved.error) return resolved;

        const entityId = resolved;

        // Check if it's a sensor
        if (entityId.startsWith('sensor.')) {
            const sensorResult = await homeAssistantManager.getSensorReading(entityId);
            logger.info('get_device_state RESULT (sensor)', { entityId, result: sensorResult });
            return sensorResult;
        }

        let stateResult = await homeAssistantManager.getState(entityId);

        // Final fallback: if state failed (e.g. 404) and we haven't tried searching yet,
        // it's possible Gemini used an incorrect entity ID format.
        if (!stateResult.success && entityId.includes('.')) {
            logger.info('Native state check failed, trying fuzzy search fallback...', { entityId });
            const domain = entityId.split('.')[0];
            const name = entityId.split('.')[1] || entityId;
            const searchResult = await homeAssistantManager.findEntityByName(name, domain);
            if (searchResult.success && searchResult.entities.length > 0) {
                stateResult = await homeAssistantManager.getState(searchResult.entities[0].id);
            }
        }

        logger.info('get_device_state RESULT', {
            entityId,
            state: stateResult.entity?.state,
            success: stateResult.success
        });
        return stateResult;
    },

    list_devices: async (args) => {
        logger.info('Executing: list_devices', args);
        if (args.type) {
            return await homeAssistantManager.getEntitiesByDomain(args.type);
        }
        return await homeAssistantManager.getEntities();
    },

    find_device: async (args) => {
        logger.info('Executing: find_device', args);

        // 1. Check custom mappings
        const mappings = db.findHaMappingsByName(args.name, args.type);

        // 2. Check native HA entities
        const nativeResult = await homeAssistantManager.findEntityByName(args.name, args.type);

        if (mappings.length > 0) {
            const mappedEntities = mappings.map(m => ({
                id: m.entity_id,
                name: m.nickname,
                location: m.location,
                type: m.type,
                is_mapped: true
            }));

            return {
                success: true,
                count: mappedEntities.length + (nativeResult.entities ? nativeResult.entities.length : 0),
                entities: [...mappedEntities, ...(nativeResult.entities || [])]
            };
        }

        return nativeResult;
    },

    set_light_brightness: async (args) => {
        logger.info('Executing: set_light_brightness', args);
        return await homeAssistantManager.setBrightness(args.entity_id, args.brightness);
    }
};

/**
 * Initialize all skill managers
 */
export async function initializeSkills() {
    logger.info('Initializing skills...');

    await calendarManager.init();
    await homeAssistantManager.init();
    await memoryManager.init();

    logger.info('All skills initialized');

    return {
        calendar: calendarManager,
        homeAssistant: homeAssistantManager,
        memory: memoryManager
    };
}

/**
 * Get status of all skills
 */
export function getSkillsStatus() {
    return {
        calendar: calendarManager.getStatus(),
        homeAssistant: homeAssistantManager.getStatus(),
        memory: memoryManager.getStatus()
    };
}

export { calendarManager, homeAssistantManager, memoryManager };
