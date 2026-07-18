import calendarManager from './CalendarManager.js';
import homeAssistantManager from './HomeAssistantManager.js';
import memoryManager from './MemoryManager.js';
import db from '../database/DatabaseManager.js';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import tenantContext from '../utils/tenantContext.js';
import whatsappManager from '../bot/WhatsAppManager.js';
import { fetchUrl, fetchRss, searchWeb } from '../utils/WebFetcher.js';

let globalGeminiManager = null;

export function setGeminiManager(manager) {
    globalGeminiManager = manager;
}

function resolveWhatsappTarget(recipient) {
    if (recipient.toLowerCase() === 'group' || recipient === 'קבוצה' || recipient === 'הקבוצה') {
        if (!config.whatsapp.groupId) return { error: 'Group ID is not configured in settings. Cannot send to group.' };
        return { jid: config.whatsapp.groupId.includes('@') ? config.whatsapp.groupId : `${config.whatsapp.groupId}@g.us` };
    }
    if (recipient.toLowerCase() === 'admin' || recipient === 'מנהל') {
        if (!config.whatsapp.adminPhone) return { error: 'Admin phone is not configured in settings.' };
        return { jid: config.whatsapp.adminPhone.includes('@') ? config.whatsapp.adminPhone : `${config.whatsapp.adminPhone}@s.whatsapp.net` };
    }
    const cleanNumber = recipient.replace(/[^0-9]/g, '');
    return { jid: `${cleanNumber}@s.whatsapp.net` };
}

// ==================== Common tools (registered in every BEHAVIOR_ENGINE mode) ====================

const COMMON_DECLARATIONS = [
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

const COMMON_HANDLERS = {
    send_whatsapp_message: async (args) => {
        logger.info('Executing: send_whatsapp_message', args);
        try {
            const target = resolveWhatsappTarget(args.recipient);
            if (target.error) return { error: target.error };

            await whatsappManager.sendMessage(target.jid, args.message);

            // Log outbound message to chat history so Noga remembers what she sent
            await db.addChatMessage(tenantContext.getTenantId(), target.jid, 'model', args.message);

            return { success: true, status: `Message sent successfully to ${args.recipient}` };
        } catch (err) {
            logger.error('Failed to execute send_whatsapp_message', { error: err.message });
            return { error: err.message };
        }
    },

    fetch_rss: async (args) => {
        logger.info('Executing: fetch_rss', { url: args.url });
        return await fetchRss(args.url, { maxItems: Math.min(args.max_items || 10, 30) });
    },

    find_device: async (args) => {
        logger.info('Executing: find_device', args);

        // 1. Check custom mappings
        const mappings = await db.findHaMappingsByName(tenantContext.getTenantId(), args.name, args.device_type);

        // 2. Check native HA entities (this tenant's own HA connection)
        const ha = await homeAssistantManager.getCurrent();
        const nativeResult = await ha.findEntityByName(args.name, args.device_type);

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

// ==================== Legacy mode: hardcoded, calendar/reminder/memory-specific tools ====================
// BEHAVIOR_ENGINE=legacy (default). Unchanged since before Block 3.

const LEGACY_DECLARATIONS = [
    {
        name: 'list_calendar_events',
        description: 'רשימת אירועים מהיומן לטווח תאריכים. Get calendar events for a date range.',
        parameters: {
            type: 'OBJECT',
            properties: {
                start_date: { type: 'STRING', description: 'תאריך התחלה בפורמט YYYY-MM-DD. Start date in YYYY-MM-DD format.' },
                end_date: { type: 'STRING', description: 'תאריך סיום בפורמט YYYY-MM-DD (אופציונלי). End date in YYYY-MM-DD format (optional).' }
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
                title: { type: 'STRING', description: 'כותרת האירוע. Event title.' },
                date: { type: 'STRING', description: 'תאריך האירוע בפורמט YYYY-MM-DD. Event date in YYYY-MM-DD format.' },
                time: { type: 'STRING', description: 'שעת האירוע בפורמט HH:MM (אופציונלי). Event time in HH:MM format (optional).' },
                duration_minutes: { type: 'NUMBER', description: 'משך האירוע בדקות, ברירת מחדל 60. Duration in minutes, default 60.' },
                description: { type: 'STRING', description: 'תיאור האירוע (אופציונלי). Event description (optional).' }
            },
            required: ['title', 'date']
        }
    },
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
    {
        name: 'read_knowledge_file',
        description: 'Read the contents of a knowledge file (e.g., USER, HOME, MEMORY).',
        parameters: {
            type: 'OBJECT',
            properties: { filename: { type: 'STRING', description: 'The name of the file to read (e.g., "MEMORY.md").' } },
            required: ['filename']
        }
    },
    {
        name: 'update_memory',
        description: 'Update the MEMORY.md file or any other knowledge file with new information.',
        parameters: {
            type: 'OBJECT',
            properties: {
                filename: { type: 'STRING', description: 'The name of the file to update (usually "MEMORY.md").' },
                content: { type: 'STRING', description: 'The full new content to write to the file. You must include all previous important information and the new information.' }
            },
            required: ['filename', 'content']
        }
    },
    {
        name: 'create_skill',
        description: 'Create a new skill (procedure) that teaches you how to perform a multi-step task.',
        parameters: {
            type: 'OBJECT',
            properties: {
                skill_name: { type: 'STRING', description: 'The name of the skill file (e.g., "guest_wifi_procedure.md").' },
                instructions: { type: 'STRING', description: 'הוראות צעד אחר צעד בפורמט Markdown. אם המשתמש לא סיפק הוראות מדויקות, עלייך לייצר אותן בעצמך על סמך מטרת המיומנות. Step-by-step instructions in Markdown. Generate them yourself if not provided.' }
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
            properties: { filename: { type: 'STRING', description: 'The name of the file to delete (e.g., "OLD_NOTES.md").' } },
            required: ['filename']
        }
    },
    {
        name: 'fetch_url',
        description: 'Fetch and read the text content of any public URL (web page, plain text, etc.). Use this to read articles, documentation, or any website. Returns cleaned text suitable for summarizing.',
        parameters: {
            type: 'OBJECT',
            properties: {
                url: { type: 'STRING', description: 'The full URL to fetch (must start with http:// or https://).' },
                max_length: { type: 'NUMBER', description: 'Maximum number of characters to return (default 50000). Lower this for large pages you only need a snippet of.' }
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
                query: { type: 'STRING', description: 'שאילתת החיפוש (עברית או אנגלית). The search query in any language.' },
                max_results: { type: 'NUMBER', description: 'Maximum number of results to return (default 5, max 10).' }
            },
            required: ['query']
        }
    }
];

const LEGACY_HANDLERS = {
    list_calendar_events: async (args) => {
        logger.info('Executing: list_calendar_events', args);
        return await calendarManager.listEvents(args.start_date, args.end_date);
    },

    add_calendar_event: async (args) => {
        logger.info('Executing: add_calendar_event', args);
        return await calendarManager.addEvent(args.title, args.date, args.time || null, args.duration_minutes || 60, args.description || '');
    },

    add_reminder: async (args) => {
        logger.info('Executing: add_reminder', args);
        const id = await db.addReminder(tenantContext.getTenantId(), args.title, args.due_date_iso, args.nudge_interval_minutes || 60);
        return { success: true, reminder_id: id, message: `Reminder added successfully.` };
    },

    get_pending_reminders: async () => {
        logger.info('Executing: get_pending_reminders');
        const reminders = await db.getPendingReminders(tenantContext.getTenantId());
        return { success: true, count: reminders.length, reminders };
    },

    update_reminder_status: async (args) => {
        logger.info('Executing: update_reminder_status', args);
        const success = await db.updateReminderStatus(tenantContext.getTenantId(), args.id, args.status);
        return { success, message: success ? `Reminder marked as ${args.status}` : 'Reminder not found' };
    },

    snooze_reminder: async (args) => {
        logger.info('Executing: snooze_reminder', args);
        const success = await db.updateReminderDueDate(tenantContext.getTenantId(), args.id, args.new_due_date_iso);
        if (success) {
            return { success: true, message: `Reminder ${args.id} successfully rescheduled to ${args.new_due_date_iso}. Nudge timer has been reset.` };
        }
        return { success: false, message: `FAILED: Reminder with ID ${args.id} was not found or could not be updated. Do NOT tell the user it was rescheduled.` };
    },

    read_knowledge_file: async (args) => {
        logger.info('Executing: read_knowledge_file', args);
        return await memoryManager.readKnowledgeFile(tenantContext.getTenantId(), args.filename);
    },

    update_memory: async (args) => {
        logger.info('Executing: update_memory', args);
        const result = await memoryManager.writeKnowledgeFile(tenantContext.getTenantId(), args.filename, args.content);
        if (result.success && globalGeminiManager) {
            await globalGeminiManager.reinit();
        }
        return result;
    },

    create_skill: async (args) => {
        logger.info('Executing: create_skill', args);
        const result = await memoryManager.createSkill(tenantContext.getTenantId(), args.skill_name, args.instructions);
        if (result.success && globalGeminiManager) {
            await globalGeminiManager.reinit();
        }
        return result;
    },

    list_memory: async () => {
        logger.info('Executing: list_memory');
        const files = await memoryManager.getKnowledgeFiles(tenantContext.getTenantId());
        return { success: true, files: files.map(f => f.name) };
    },

    delete_memory: async (args) => {
        logger.info('Executing: delete_memory', args);
        const result = await memoryManager.deleteKnowledgeFile(tenantContext.getTenantId(), args.filename);
        if (result.success && globalGeminiManager) {
            await globalGeminiManager.reinit();
        }
        return result;
    },

    fetch_url: async (args) => {
        logger.info('Executing: fetch_url', { url: args.url });
        return await fetchUrl(args.url, { maxLength: args.max_length || 50000 });
    },

    web_search: async (args) => {
        logger.info('Executing: web_search', { query: args.query });
        const result = await searchWeb(args.query, { maxResults: Math.min(args.max_results || 5, 10) });
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
    }
};

// ==================== Markdown mode: generic tool primitives ====================
// BEHAVIOR_ENGINE=markdown. Decision logic that used to live in each function's name/
// description now lives in the tenant's markdown skill files (PromptBuilder injects them).
// Reminders keep their dedicated primitives (the reminders table/nudge tracking has no
// generic equivalent) but gain get_reminder_by_msg_id/log_reminder. Jobs reuse the existing
// scheduled_prompts table/DatabaseManager methods under generic names — no schema change.

const MARKDOWN_DECLARATIONS = [
    {
        name: 'calendar_list_events',
        description: 'List calendar events for a date range.',
        parameters: {
            type: 'OBJECT',
            properties: {
                start_date: { type: 'STRING', description: 'Start date in YYYY-MM-DD format.' },
                end_date: { type: 'STRING', description: 'End date in YYYY-MM-DD format (optional).' }
            },
            required: ['start_date']
        }
    },
    {
        name: 'calendar_create_event',
        description: 'Add a new event to the calendar.',
        parameters: {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING', description: 'Event title.' },
                date: { type: 'STRING', description: 'Event date in YYYY-MM-DD format.' },
                time: { type: 'STRING', description: 'Event time in HH:MM format (optional, omit for all-day).' },
                duration_minutes: { type: 'NUMBER', description: 'Duration in minutes, default 60.' },
                description: { type: 'STRING', description: 'Event description (optional).' }
            },
            required: ['title', 'date']
        }
    },
    {
        name: 'add_reminder',
        description: 'Add a reminder/to-do. Noga will nudge the user via WhatsApp until it is marked done.',
        parameters: {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING', description: 'Task description.' },
                due_date_iso: { type: 'STRING', description: 'When to nudge first. Must be UTC ISO format (ending with Z).' },
                nudge_interval_minutes: { type: 'NUMBER', description: 'Repeat nudge frequency in minutes. Default 60.' }
            },
            required: ['title', 'due_date_iso']
        }
    },
    {
        name: 'get_pending_reminders',
        description: 'Get all pending reminders.',
        parameters: { type: 'OBJECT', properties: { dummy: { type: 'STRING', description: 'Ignore' } } }
    },
    {
        name: 'update_reminder_status',
        description: 'Mark a reminder as done or cancelled.',
        parameters: {
            type: 'OBJECT',
            properties: {
                id: { type: 'NUMBER', description: 'Reminder ID.' },
                status: { type: 'STRING', description: 'New status: "done" or "cancelled".' }
            },
            required: ['id', 'status']
        }
    },
    {
        name: 'snooze_reminder',
        description: 'Reschedule an existing reminder to a later time.',
        parameters: {
            type: 'OBJECT',
            properties: {
                id: { type: 'NUMBER', description: 'Reminder ID.' },
                new_due_date_iso: { type: 'STRING', description: 'New due date/time. Must be UTC ISO format (ending with Z).' }
            },
            required: ['id', 'new_due_date_iso']
        }
    },
    {
        name: 'get_reminder_by_msg_id',
        description: 'Look up the pending reminder associated with a WhatsApp nudge message ID (e.g. when the user replies to or reacts on a specific nudge).',
        parameters: {
            type: 'OBJECT',
            properties: { message_id: { type: 'STRING', description: 'The WhatsApp message ID of the nudge.' } },
            required: ['message_id']
        }
    },
    {
        name: 'log_reminder',
        description: 'Record a note against a reminder (e.g. why it was snoozed, what the user said about it) without changing its status.',
        parameters: {
            type: 'OBJECT',
            properties: {
                id: { type: 'NUMBER', description: 'Reminder ID.' },
                note: { type: 'STRING', description: 'Note to record.' }
            },
            required: ['id', 'note']
        }
    },
    {
        name: 'create_job',
        description: 'Create a recurring scheduled job — a prompt that runs automatically on a cron schedule and is sent to the family group (e.g. a daily morning briefing).',
        parameters: {
            type: 'OBJECT',
            properties: {
                name: { type: 'STRING', description: 'Short name for the job.' },
                prompt: { type: 'STRING', description: 'The prompt to run each time the job fires.' },
                cron_expression: { type: 'STRING', description: 'Standard 5-field cron expression, e.g. "0 7 * * *" for daily at 7am.' },
                enabled: { type: 'BOOLEAN', description: 'Whether the job is active. Default true.' }
            },
            required: ['name', 'prompt', 'cron_expression']
        }
    },
    {
        name: 'list_jobs',
        description: 'List all scheduled jobs.',
        parameters: { type: 'OBJECT', properties: { dummy: { type: 'STRING', description: 'Ignore' } } }
    },
    {
        name: 'cancel_job',
        description: 'Cancel (delete) a scheduled job.',
        parameters: {
            type: 'OBJECT',
            properties: { id: { type: 'NUMBER', description: 'Job ID (from list_jobs).' } },
            required: ['id']
        }
    },
    {
        name: 'read_file',
        description: 'Read a knowledge or skill markdown file.',
        parameters: {
            type: 'OBJECT',
            properties: {
                kind: { type: 'STRING', description: '"knowledge" or "skills".' },
                filename: { type: 'STRING', description: 'File name, e.g. "MEMORY.md".' }
            },
            required: ['kind', 'filename']
        }
    },
    {
        name: 'write_file',
        description: 'Write (create or overwrite) a knowledge or skill markdown file. For knowledge files, include all previous important content plus the new information.',
        parameters: {
            type: 'OBJECT',
            properties: {
                kind: { type: 'STRING', description: '"knowledge" or "skills".' },
                filename: { type: 'STRING', description: 'File name, e.g. "MEMORY.md".' },
                content: { type: 'STRING', description: 'Full new file content.' }
            },
            required: ['kind', 'filename', 'content']
        }
    },
    {
        name: 'search_files',
        description: 'Search knowledge and skill file names for a substring match.',
        parameters: {
            type: 'OBJECT',
            properties: { query: { type: 'STRING', description: 'Substring to search for in file names.' } },
            required: ['query']
        }
    },
    {
        name: 'http_get_json',
        description: 'Fetch and read the text/JSON content of any public URL. Use this to read articles, documentation, APIs, or any website.',
        parameters: {
            type: 'OBJECT',
            properties: {
                url: { type: 'STRING', description: 'The full URL to fetch (must start with http:// or https://).' },
                max_length: { type: 'NUMBER', description: 'Maximum number of characters to return (default 50000).' }
            },
            required: ['url']
        }
    },
    {
        name: 'search_web_api',
        description: 'Search the web for current information - news, facts, prices, people, places, products, etc.',
        parameters: {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'The search query, any language.' },
                max_results: { type: 'NUMBER', description: 'Maximum number of results to return (default 5, max 10).' }
            },
            required: ['query']
        }
    }
];

const MARKDOWN_HANDLERS = {
    calendar_list_events: async (args) => {
        logger.info('Executing: calendar_list_events', args);
        return await calendarManager.listEvents(args.start_date, args.end_date);
    },

    calendar_create_event: async (args) => {
        logger.info('Executing: calendar_create_event', args);
        return await calendarManager.addEvent(args.title, args.date, args.time || null, args.duration_minutes || 60, args.description || '');
    },

    add_reminder: async (args) => {
        logger.info('Executing: add_reminder', args);
        const id = await db.addReminder(tenantContext.getTenantId(), args.title, args.due_date_iso, args.nudge_interval_minutes || 60);
        return { success: true, reminder_id: id, message: `Reminder added successfully.` };
    },

    get_pending_reminders: async () => {
        logger.info('Executing: get_pending_reminders');
        const reminders = await db.getPendingReminders(tenantContext.getTenantId());
        return { success: true, count: reminders.length, reminders };
    },

    update_reminder_status: async (args) => {
        logger.info('Executing: update_reminder_status', args);
        const success = await db.updateReminderStatus(tenantContext.getTenantId(), args.id, args.status);
        return { success, message: success ? `Reminder marked as ${args.status}` : 'Reminder not found' };
    },

    snooze_reminder: async (args) => {
        logger.info('Executing: snooze_reminder', args);
        const success = await db.updateReminderDueDate(tenantContext.getTenantId(), args.id, args.new_due_date_iso);
        if (success) {
            return { success: true, message: `Reminder ${args.id} successfully rescheduled to ${args.new_due_date_iso}. Nudge timer has been reset.` };
        }
        return { success: false, message: `FAILED: Reminder with ID ${args.id} was not found or could not be updated. Do NOT tell the user it was rescheduled.` };
    },

    get_reminder_by_msg_id: async (args) => {
        logger.info('Executing: get_reminder_by_msg_id', args);
        const reminder = await db.getReminderByNudgeMessageId(tenantContext.getTenantId(), args.message_id);
        return reminder ? { success: true, reminder } : { success: false, message: 'No pending reminder found for that message ID.' };
    },

    log_reminder: async (args) => {
        logger.info('Executing: log_reminder', args);
        await db.logAction(tenantContext.getTenantId(), null, 'reminder_note', { reminderId: args.id, note: args.note });
        return { success: true, message: 'Note recorded.' };
    },

    create_job: async (args) => {
        logger.info('Executing: create_job', args);
        const id = await db.addScheduledPrompt(tenantContext.getTenantId(), args.name, args.prompt, args.cron_expression, args.enabled !== false);
        return { success: true, job_id: id, message: 'Job created successfully.' };
    },

    list_jobs: async () => {
        logger.info('Executing: list_jobs');
        const jobs = await db.getScheduledPrompts(tenantContext.getTenantId());
        return { success: true, count: jobs.length, jobs };
    },

    cancel_job: async (args) => {
        logger.info('Executing: cancel_job', args);
        await db.deleteScheduledPrompt(tenantContext.getTenantId(), args.id);
        return { success: true, message: `Job ${args.id} cancelled.` };
    },

    read_file: async (args) => {
        logger.info('Executing: read_file', args);
        return await memoryManager.readFile(tenantContext.getTenantId(), args.kind, args.filename);
    },

    write_file: async (args) => {
        logger.info('Executing: write_file', args);
        const result = await memoryManager.writeFile(tenantContext.getTenantId(), args.kind, args.filename, args.content);
        if (result.success && globalGeminiManager) {
            await globalGeminiManager.reinit();
        }
        return result;
    },

    search_files: async (args) => {
        logger.info('Executing: search_files', args);
        return await memoryManager.searchFiles(tenantContext.getTenantId(), args.query);
    },

    http_get_json: async (args) => {
        logger.info('Executing: http_get_json', { url: args.url });
        return await fetchUrl(args.url, { maxLength: args.max_length || 50000 });
    },

    search_web_api: async (args) => {
        logger.info('Executing: search_web_api', { query: args.query });
        const result = await searchWeb(args.query, { maxResults: Math.min(args.max_results || 5, 10) });
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
    }
};

// Populated in initializeSkills() based on config.behaviorEngine, then further extended with
// dynamically-discovered Home Assistant MCP tools. Exported as mutable bindings (not reassigned)
// so geminiManager.init(), called after initializeSkills() resolves, sees the final contents.
export const functionDeclarations = [];
export const functionHandlers = {};

/**
 * Initialize all skill managers
 */
export async function initializeSkills() {
    logger.info('Initializing skills...');

    await calendarManager.init();
    // Block 4 Phase 2: HA is now a per-tenant registry. Eagerly connect the default tenant here
    // (matches pre-Phase-2 startup behavior exactly) — other tenants' connections are created
    // lazily on their first tool call. See HomeAssistantRegistry's docstring for the known
    // limitation this implies: the MCP tool list below is built once from this default
    // connection, shared across tenants, even though each tool call executes against the
    // calling tenant's own HA instance.
    const defaultHa = await homeAssistantManager.getForTenant(config.tenantId);
    await memoryManager.init(tenantContext.getTenantId());

    const modeDeclarations = config.behaviorEngine === 'markdown' ? MARKDOWN_DECLARATIONS : LEGACY_DECLARATIONS;
    const modeHandlers = config.behaviorEngine === 'markdown' ? MARKDOWN_HANDLERS : LEGACY_HANDLERS;

    functionDeclarations.push(...COMMON_DECLARATIONS, ...modeDeclarations);
    Object.assign(functionHandlers, COMMON_HANDLERS, modeHandlers);

    logger.info(`Registered ${functionDeclarations.length} tool(s) for BEHAVIOR_ENGINE=${config.behaviorEngine}`);

    // Register MCP tools dynamically
    if (defaultHa.isAvailable()) {
        try {
            const { tools } = await defaultHa.getMcpClient().listTools();
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

                // Add to handlers — resolves the CALLING tenant's own HA connection at execution
                // time, not the default tenant's connection used to build the declaration above.
                functionHandlers[tool.name] = async (args) => {
                    logger.info(`Executing MCP tool: ${tool.name}`, args);
                    try {
                        const ha = await homeAssistantManager.getCurrent();
                        if (!ha.isAvailable()) {
                            return { error: 'Home Assistant not available for this tenant' };
                        }
                        const result = await ha.getMcpClient().callTool({
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
export async function getSkillsStatus() {
    const ha = await homeAssistantManager.getCurrent();
    return {
        calendar: calendarManager.getStatus(),
        homeAssistant: ha.getStatus(),
        memory: await memoryManager.getStatus(tenantContext.getTenantId())
    };
}

export { calendarManager, homeAssistantManager, memoryManager };
