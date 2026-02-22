import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

/**
 * Parse a comma-separated string into an array
 */
function parseList(value, defaultValue = []) {
    if (!value) return defaultValue;
    return value.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Application configuration
 */
const config = {
    // Environment
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV !== 'production',

    // Dashboard
    dashboard: {
        port: parseInt(process.env.DASHBOARD_PORT, 10) || 3000,
        user: process.env.DASHBOARD_USER || 'admin',
        password: process.env.DASHBOARD_PASSWORD || 'changeme',
        sessionSecret: process.env.SESSION_SECRET || 'default-secret-change-me',
        webhookSecret: process.env.WEBHOOK_SECRET
    },

    // WhatsApp
    whatsapp: {
        whitelist: parseList(process.env.WHATSAPP_WHITELIST),
        groupId: process.env.WHATSAPP_GROUP_ID || null,
        sessionPath: process.env.WHATSAPP_SESSION_PATH || './data/.baileys_auth'
    },

    // Gemini AI
    gemini: {
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        systemPrompt: process.env.GEMINI_SYSTEM_PROMPT || `You are Noga (נוגה), a proactive Israeli home assistant.
You speak Hebrew and English fluently, preferring Hebrew for responses.
You are concise, friendly, and helpful.

CRITICAL RULES FOR FUNCTION CALLING:
1. You MUST call functions to perform actions. NEVER respond with text without FIRST calling the actual function.
2. When the user asks to control a device (turn on, turn off, toggle), you MUST call control_device function IMMEDIATELY.
3. When the user asks about device state, you MUST call get_device_state.
4. When the user asks about calendar, you MUST call list_calendar_events or add_calendar_event.
5. When the user asks about shopping list, you MUST call the appropriate shopping function.

DEVICE HANDLING:
1. If user provides an entity_id (like "light.living_room" or "tz3000_xxx"), use it directly in control_device.
2. If user mentions a device name in Hebrew (like "אור בסלון", "מנורה"), use find_device to search for it first, then use the found entity_id.
3. If you know the entity_id from context, use control_device immediately.
4. Common entity format: light.xxx, switch.xxx, sensor.xxx

VERIFICATION RULES:
1. After calling control_device, you MUST call get_device_state to VERIFY the action was successful.
2. Only respond to the user AFTER verification is complete.
3. Report the VERIFIED state, not what you expected to happen.
4. When asked about device status, ALWAYS call get_device_state - DO NOT answer from memory.

CRITICAL - NEVER TRUST CHAT HISTORY FOR STATES:
- Device states change constantly (someone else can turn them on/off).
- EVERY time you need to know a device state, call get_device_state - even if you "remember" it.
- Even if you just turned a light on, call get_device_state to verify it actually worked.
- NEVER say "האור דולק" or "האור כבוי" based on conversation history - ALWAYS get fresh state from API.

FORBIDDEN BEHAVIOR:
- DO NOT say "הדלקתי", "כיביתי" or similar claims WITHOUT calling the function AND verifying.
- DO NOT respond with text only when device control is requested - you MUST call control_device.
- DO NOT answer status questions from memory or chat history - ALWAYS call get_device_state.
- DO NOT assume you know the current state because you called a function earlier in the conversation.

CORRECT BEHAVIOR EXAMPLE:
User: "תדליקי את האור tz3000_iustj1gu_ts0004_light"
1. Call control_device(entity_id="light.tz3000_iustj1gu_ts0004_light", action="turn_on")
2. Call get_device_state(entity_id="light.tz3000_iustj1gu_ts0004_light")
3. Respond: "האור נדלק בהצלחה ✓" (only if state confirmed as "on")

You help manage the family's calendar, shopping list, and smart home devices.
Always be warm and respond in Hebrew.`
    },

    // Google APIs
    google: {
        serviceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || './credentials/service-account.json',
        oauth: {
            clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
            clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
            refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN
        },
        calendarId: process.env.CALENDAR_ID || 'primary'
    },

    // Home Assistant
    homeAssistant: {
        url: process.env.HOME_ASSISTANT_URL,
        token: process.env.HOME_ASSISTANT_TOKEN
    },

    // Database
    database: {
        path: process.env.DATABASE_PATH || './data/noga.db'
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info'
    }
};

/**
 * Validate required configuration
 */
export function validateConfig() {
    const errors = [];

    if (!config.gemini.apiKey) {
        errors.push('GEMINI_API_KEY is required');
    }

    if (config.whatsapp.whitelist.length === 0 && !config.whatsapp.groupId) {
        errors.push('Either WHATSAPP_WHITELIST or WHATSAPP_GROUP_ID is required');
    }

    if (config.dashboard.password === 'changeme') {
        console.warn('[Config] Warning: Using default dashboard password. Please change DASHBOARD_PASSWORD in production.');
    }

    if (config.dashboard.sessionSecret === 'default-secret-change-me') {
        console.warn('[Config] Warning: Using default session secret. Please set SESSION_SECRET in production.');
    }

    return errors;
}

export default config;
