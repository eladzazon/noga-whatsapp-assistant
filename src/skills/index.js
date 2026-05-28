import calendarManager from './CalendarManager.js';
import homeAssistantManager from './HomeAssistantManager.js';
import memoryManager from './MemoryManager.js';
import db from '../database/DatabaseManager.js';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import whatsappManager from '../bot/WhatsAppManager.js';
import { fetchUrl, fetchRss, searchWeb } from '../utils/WebFetcher.js';

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
            type: 'OBJECT',
            properties: {
                start_date: {
                    type: 'STRING',
                    description: 'תאריך התחלה בפורמט YYYY-MM-DD. Start date in YYYY-MM-DD format.'
                },
                end_date: {
                    type: 'STRING',
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
            type: 'OBJECT',
            properties: {
                title: {
                    type: 'STRING',
                    description: 'כותרת האירוע. Event title.'
                },
                date: {
                    type: 'STRING',
                    description: 'תאריך האירוע בפורמט YYYY-MM-DD. Event date in YYYY-MM-DD format.'
                },
                time: {
                    type: 'STRING',
                    description: 'שעת האירוע בפורמט HH:MM (אופציונלי). Event time in HH:MM format (optional).'
                },
                duration_minutes: {
                    type: 'NUMBER',
                    description: 'משך האירוע בדקות, ברירת מחדל 60. Duration in minutes, default 60.'
                },
                description: {
                    type: 'STRING',
                    description: 'תיאור האירוע (אופציונלי). Event description (optional).'
                }
            },
            required: ['title', 'date']
        }
    },


    // ==================== Reminders ====================
    {
        name: 'add_reminder',
        description: 'הוסף תזכורת או משימה שיש לבצע (To-Do). Noga will nudge the user until it is done. Add a new reminder.',
        parameters: {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING', description: 'תיאור התזכורת. Task description.' },
                due_date_iso: { type: 'STRING', description: 'מתי להזכיר לראשונה. חובה להשתמש בפורמט UTC ISO (למשל סיומת Z). Use UTC ISO format (ending with Z).' },
                nudge_interval_minutes: { type: 'NUMBER', description: 'תדירות תזכורות חוזרות בדקות. ברירת מחדל 60.' }
            },
            required: ['title', 'due_date_iso']
        }
    },
    {
        name: 'get_pending_reminders',
        description: 'הצג את כל התזכורות והמשימות שממתינות לביצוע. Get all pending reminders.',
        parameters: { type: 'OBJECT', properties: { dummy: { type: 'STRING', description: 'Ignore' } } }
    },
    {
        name: 'update_reminder_status',
        description: 'עדכן סטטוס של תזכורת (לסמן כבוצע או מבוטל). Mark reminder as done or cancelled.',
        parameters: {
            type: 'OBJECT',
            properties: {
                id: { type: 'NUMBER', description: 'מזהה התזכורת. Reminder ID.' },
                status: { type: 'STRING', description: 'סטטוס חדש: "done" או "cancelled".' }
            },
            required: ['id', 'status']
        }
    },
    {
        name: 'snooze_reminder',
        description: 'דחה תזכורת קיימת לזמן מאוחר יותר. Snooze a reminder.',
        parameters: {
            type: 'OBJECT',
            properties: {
                id: { type: 'NUMBER', description: 'מזהה התזכורת. Reminder ID.' },
                new_due_date_iso: { type: 'STRING', description: 'תאריך ושעה חדשים לתזכורת. חובה להשתמש בפורמט UTC ISO (למשל סיומת Z).' }
            },
            required: ['id', 'new_due_date_iso']
        }
    },

    // ==================== Shopping List Functions Removed (Now a Skill) ====================

    // ==================== Memory/Agentic Functions ====================
    {
        name: 'read_knowledge_file',
        description: 'Read the contents of a knowledge file (e.g., USER, HOME, MEMORY).',
        parameters: {
            type: 'OBJECT',
            properties: {
                filename: {
                    type: 'STRING',
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
            type: 'OBJECT',
            properties: {
                filename: {
                    type: 'STRING',
                    description: 'The name of the file to update (usually "MEMORY.md").'
                },
                content: {
                    type: 'STRING',
                    description: 'The full new content to write to the file. You must include all previous important information and the new information.'
                }
            },
            required: ['filename', 'content']
        }
    },
    {
        name: 'send_whatsapp_message',
        description: 'שלח הודעת וואטסאפ לאדם אחר או לקבוצה. השתמש בזה כשהמשתמש מבקש ממך למסור הודעה או לשלוח משהו לקבוצה המשפחתית. Send a WhatsApp message to the family group or admin.',
        parameters: {
            type: 'OBJECT',
            properties: {
                recipient: {
                    type: 'STRING',
                    description: 'הנמען. השתמש בערך "group" עבור הקבוצה המשפחתית, "admin" עבור המנהל, או מספר טלפון ספציפי.'
                },
                message: {
                    type: 'STRING',
                    description: 'ההודעה שברצונך לשלוח (נסח בצורה טבעית וחברית בעברית).'
                }
            },
            required: ['recipient', 'message']
        }
    },
    {
        name: 'create_skill',
        description: 'Create a new skill (procedure) that teaches you how to perform a multi-step task.',
        parameters: {
            type: 'OBJECT',
            properties: {
                skill_name: {
                    type: 'STRING',
                    description: 'The name of the skill file (e.g., "guest_wifi_procedure.md").'
                },
                instructions: {
                    type: 'STRING',
                    description: 'הוראות צעד אחר צעד בפורמט Markdown. אם המשתמש לא סיפק הוראות מדויקות, עלייך לייצר אותן בעצמך על סמך מטרת המיומנות. Step-by-step instructions in Markdown. Generate them yourself if not provided.'
                }
            },
            required: ['skill_name', 'instructions']
        }
    },
    {
        name: 'list_memory',
        description: 'List all available knowledge and memory files.',
        parameters: { type: 'OBJECT', properties: { dummy: { type: 'STRING', description: 'Ignore' } } }
    },
    {
        name: 'delete_memory',
        description: 'Delete a knowledge or memory file.',
        parameters: {
            type: 'OBJECT',
            properties: {
                filename: {
                    type: 'STRING',
                    description: 'The name of the file to delete (e.g., "OLD_NOTES.md").'
                }
            },
            required: ['filename']
        }
    },
    // ==================== Web Fetch Functions ====================
    {
        name: 'fetch_url',
        description: 'Fetch and read the text content of any public URL (web page, plain text, etc.). Use this to read articles, documentation, or any website. Returns cleaned text suitable for summarizing.',
        parameters: {
            type: 'OBJECT',
            properties: {
                url: {
                    type: 'STRING',
                    description: 'The full URL to fetch (must start with http:// or https://).'
                },
                max_length: {
                    type: 'NUMBER',
                    description: 'Maximum number of characters to return (default 50000). Lower this for large pages you only need a snippet of.'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'fetch_rss',
        description: 'Fetch and parse an RSS or Atom news feed. Returns a clean list of articles with titles, links, publication dates, and summaries. Perfect for news briefings, blog updates, or any RSS-based content.',
        parameters: {
            type: 'OBJECT',
            properties: {
                url: {
                    type: 'STRING',
                    description: 'The full URL of the RSS or Atom feed.'
                },
                max_items: {
                    type: 'NUMBER',
                    description: 'Maximum number of articles to return (default 10, max 30).'
                }
            },
            required: ['url']
        }
    },
    {
        name: 'web_search',
        description: 'חפש מידע באינטרנט. Search the web for any information - current events, exchange rates, weather, facts, people, places, products, etc. Use this when you need up-to-date information that you don\'t have in your knowledge. Returns search results with titles, snippets, and links.',
        parameters: {
            type: 'OBJECT',
            properties: {
                query: {
                    type: 'STRING',
                    description: 'שאילתת החיפוש (עברית או אנגלית). The search query in any language.'
                },
                max_results: {
                    type: 'NUMBER',
                    description: 'Maximum number of results to return (default 5, max 10).'
                }
            },
            required: ['query']
        }
    },

    // ==================== Home Assistant Functions ====================
    {
        name: 'find_device',
        description: 'מצא מכשיר לפי שם. Find a device by name. Use this tool BEFORE calling Home Assistant MCP tools if you are unsure of the exact entity_id, as it supports custom nicknames.',
        parameters: {
            type: 'OBJECT',
            properties: {
                name: {
                    type: 'STRING',
                    description: 'שם המכשיר לחיפוש. Device name to search.'
                },
                device_type: {
                    type: 'STRING',
                    description: 'סוג המכשיר (אופציונלי). Device type (optional).'
                }
            },
            required: ['name']
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

    // ==================== Reminder Handlers ====================
    add_reminder: async (args) => {
        logger.info('Executing: add_reminder', args);
        const id = db.addReminder(args.title, args.due_date_iso, args.nudge_interval_minutes || 60);
        return { success: true, reminder_id: id, message: `Reminder added successfully.` };
    },

    get_pending_reminders: async () => {
        logger.info('Executing: get_pending_reminders');
        const reminders = db.getPendingReminders();
        return { success: true, count: reminders.length, reminders };
    },

    update_reminder_status: async (args) => {
        logger.info('Executing: update_reminder_status', args);
        const success = db.updateReminderStatus(args.id, args.status);
        return { success, message: success ? `Reminder marked as ${args.status}` : 'Reminder not found' };
    },

    snooze_reminder: async (args) => {
        logger.info('Executing: snooze_reminder', args);
        const success = db.updateReminderDueDate(args.id, args.new_due_date_iso);
        return { success, message: success ? 'Reminder snoozed' : 'Reminder not found' };
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

    send_whatsapp_message: async (args) => {
        logger.info('Executing: send_whatsapp_message', args);
        try {
            let targetJid;
            
            if (args.recipient.toLowerCase() === 'group' || args.recipient === 'קבוצה' || args.recipient === 'הקבוצה') {
                if (!config.whatsapp.groupId) return { error: 'Group ID is not configured in settings. Cannot send to group.' };
                targetJid = config.whatsapp.groupId.includes('@') ? config.whatsapp.groupId : `${config.whatsapp.groupId}@g.us`;
            } else if (args.recipient.toLowerCase() === 'admin' || args.recipient === 'מנהל') {
                if (!config.whatsapp.adminPhone) return { error: 'Admin phone is not configured in settings.' };
                targetJid = config.whatsapp.adminPhone.includes('@') ? config.whatsapp.adminPhone : `${config.whatsapp.adminPhone}@s.whatsapp.net`;
            } else {
                // Assume it's a specific number
                const cleanNumber = args.recipient.replace(/[^0-9]/g, '');
                targetJid = `${cleanNumber}@s.whatsapp.net`;
            }

            await whatsappManager.sendMessage(targetJid, args.message);

            // Log outbound message to chat history so Noga remembers what she sent
            db.addChatMessage(targetJid, 'model', args.message);

            return { success: true, status: `Message sent successfully to ${args.recipient}` };
        } catch (err) {
            logger.error('Failed to execute send_whatsapp_message', { error: err.message });
            return { error: err.message };
        }
    },

    // ==================== Web Fetch Handlers ====================
    fetch_url: async (args) => {
        logger.info('Executing: fetch_url', { url: args.url });
        return await fetchUrl(args.url, { maxLength: args.max_length || 50000 });
    },

    fetch_rss: async (args) => {
        logger.info('Executing: fetch_rss', { url: args.url });
        return await fetchRss(args.url, { maxItems: Math.min(args.max_items || 10, 30) });
    },

    web_search: async (args) => {
        logger.info('Executing: web_search', { query: args.query });
        const result = await searchWeb(args.query, { maxResults: Math.min(args.max_results || 5, 10) });
        // If we got results but no instant answer, auto-fetch the top result for a richer answer
        if (result.success && !result.instant_answer && result.results?.length > 0) {
            try {
                const topUrl = result.results[0].url;
                const page = await fetchUrl(topUrl, { maxLength: 8000 });
                if (page.success) {
                    result.top_result_content = page.content;
                }
            } catch (e) {
                // Non-critical — snippets are still available
            }
        }
        return result;
    },

    // ==================== Home Assistant Handlers ====================
    find_device: async (args) => {
        logger.info('Executing: find_device', args);

        // 1. Check custom mappings
        const mappings = db.findHaMappingsByName(args.name, args.device_type);

        // 2. Check native HA entities
        const nativeResult = await homeAssistantManager.findEntityByName(args.name, args.device_type);

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

    // Register MCP tools dynamically
    if (homeAssistantManager.isAvailable()) {
        try {
            const mcpClient = homeAssistantManager.getMcpClient();
            const { tools } = await mcpClient.listTools();
            logger.info(`Fetched ${tools.length} MCP tools from Home Assistant`);

            for (const tool of tools) {
                // Add to declarations
                functionDeclarations.push({
                    name: tool.name,
                    description: tool.description || `Home Assistant MCP Tool: ${tool.name}`,
                    parameters: {
                        type: 'OBJECT',
                        properties: tool.inputSchema?.properties || {},
                        required: tool.inputSchema?.required || []
                    }
                });

                // Add to handlers
                functionHandlers[tool.name] = async (args) => {
                    logger.info(`Executing MCP tool: ${tool.name}`, args);
                    try {
                        const result = await mcpClient.callTool({
                            name: tool.name,
                            arguments: args
                        });
                        
                        if (result && result.content && result.content.length > 0) {
                            const text = result.content[0].text;
                            try { return JSON.parse(text); } catch (e) { return { result: text }; }
                        }
                        return { success: true };
                    } catch (err) {
                        logger.error(`Error executing MCP tool ${tool.name}`, { error: err.message });
                        return { error: err.message };
                    }
                };
            }
        } catch (err) {
            logger.error('Failed to register MCP tools', { error: err.message });
        }
    }

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
