import calendarManager from './CalendarManager.js';
import tasksManager from './TasksManager.js';
import homeAssistantManager from './HomeAssistantManager.js';
import logger from '../utils/logger.js';

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

    // ==================== Shopping List Functions ====================
    {
        name: 'add_shopping_item',
        description: 'הוסף פריט לרשימת הקניות. Add an item to the shopping list.',
        parameters: {
            type: 'object',
            properties: {
                item: {
                    type: 'string',
                    description: 'שם הפריט להוספה. Item name to add.'
                }
            },
            required: ['item']
        }
    },
    {
        name: 'get_shopping_list',
        description: 'הצג את רשימת הקניות הנוכחית. Get the current shopping list.',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'complete_shopping_item',
        description: 'סמן פריט כנקנה/הושלם ברשימת הקניות. Mark a shopping item as completed.',
        parameters: {
            type: 'object',
            properties: {
                item: {
                    type: 'string',
                    description: 'שם הפריט לסימון. Item name to mark as done.'
                }
            },
            required: ['item']
        }
    },
    {
        name: 'delete_shopping_item',
        description: 'מחק פריט מרשימת הקניות. Delete an item from the shopping list.',
        parameters: {
            type: 'object',
            properties: {
                item: {
                    type: 'string',
                    description: 'שם הפריט למחיקה. Item name to delete.'
                }
            },
            required: ['item']
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

    // ==================== Shopping List Handlers ====================
    add_shopping_item: async (args) => {
        logger.info('Executing: add_shopping_item', args);
        return await tasksManager.addTask(args.item);
    },

    get_shopping_list: async () => {
        logger.info('Executing: get_shopping_list');
        return await tasksManager.getTasks();
    },

    complete_shopping_item: async (args) => {
        logger.info('Executing: complete_shopping_item', args);
        return await tasksManager.completeTask(args.item);
    },

    delete_shopping_item: async (args) => {
        logger.info('Executing: delete_shopping_item', args);
        return await tasksManager.deleteTask(args.item);
    },

    // ==================== Home Assistant Handlers ====================
    control_device: async (args) => {
        logger.info('Executing: control_device', args);

        let entityId = args.entity_id;

        // Detect if this looks like a friendly name rather than an entity ID
        // Entity IDs are like "light.living_room" - lowercase, no spaces, has a dot
        // Friendly names can be "Living Room Light" or "תאורת כניסה 1"
        const looksLikeFriendlyName = !entityId.includes('.') ||  // No dot
            /[A-Z]/.test(entityId) ||  // Has uppercase letters
            /\s/.test(entityId) ||     // Has spaces
            /[\u0590-\u05FF]/.test(entityId);  // Has Hebrew characters

        if (looksLikeFriendlyName) {
            logger.info('Entity looks like friendly name, searching...', { entityId });
            const result = await homeAssistantManager.findEntityByName(entityId);
            if (result.success && result.entities.length > 0) {
                entityId = result.entities[0].id;
                logger.info('Found entity by name', { original: args.entity_id, resolved: entityId });
            } else {
                return result;
            }
        }

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

        let entityId = args.entity_id;

        // Detect if this looks like a friendly name rather than an entity ID
        const looksLikeFriendlyName = !entityId.includes('.') ||
            /[A-Z]/.test(entityId) ||
            /\s/.test(entityId) ||
            /[\u0590-\u05FF]/.test(entityId);

        if (looksLikeFriendlyName) {
            logger.info('Entity looks like friendly name, searching...', { entityId });
            const result = await homeAssistantManager.findEntityByName(entityId);
            if (result.success && result.entities.length > 0) {
                entityId = result.entities[0].id;
                logger.info('Found entity by name', { original: args.entity_id, resolved: entityId });
            } else {
                return result;
            }
        }

        // Check if it's a sensor
        if (entityId.startsWith('sensor.')) {
            const sensorResult = await homeAssistantManager.getSensorReading(entityId);
            logger.info('get_device_state RESULT (sensor)', { entityId, result: sensorResult });
            return sensorResult;
        }

        const stateResult = await homeAssistantManager.getState(entityId);
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
        return await homeAssistantManager.findEntityByName(args.name, args.type);
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
    await tasksManager.init();
    await homeAssistantManager.init();

    logger.info('All skills initialized');

    return {
        calendar: calendarManager,
        tasks: tasksManager,
        homeAssistant: homeAssistantManager
    };
}

/**
 * Get status of all skills
 */
export function getSkillsStatus() {
    return {
        calendar: calendarManager.getStatus(),
        tasks: tasksManager.getStatus(),
        homeAssistant: homeAssistantManager.getStatus()
    };
}

export { calendarManager, tasksManager, homeAssistantManager };
