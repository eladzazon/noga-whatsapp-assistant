import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Thin client the admin-portal process uses to reach the orchestrator's internal API
 * (src/internal/server.js) for anything that depends on live in-memory state. See that file's
 * docstring for what is and isn't proxied here.
 */
async function callInternal(method, path, body) {
    const url = `${config.internal.orchestratorUrl}${path}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': config.internal.secret
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || `Internal API returned ${res.status}`);
        }
        return data;
    } catch (err) {
        logger.error('[internalApiClient] Request failed', { path, error: err.message });
        throw err;
    }
}

export async function getStatus() {
    return callInternal('GET', '/internal/status');
}

export async function reinit() {
    return callInternal('POST', '/internal/reinit');
}

export async function chat(text, tenantId) {
    const { text: response } = await callInternal('POST', '/internal/chat', { text, tenantId });
    return response;
}

export async function clearChat(tenantId) {
    return callInternal('POST', '/internal/clear-chat', { tenantId });
}

export async function broadcast(eventData) {
    const { message } = await callInternal('POST', '/internal/broadcast', eventData);
    return message;
}

export async function reloadSchedules() {
    return callInternal('POST', '/internal/reload-schedules');
}

export async function getHaEntities(tenantId) {
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
    return callInternal('GET', `/internal/ha/entities${qs}`);
}

export async function whatsappDisconnect() {
    return callInternal('POST', '/internal/whatsapp/disconnect');
}

export async function whatsappReconnect() {
    return callInternal('POST', '/internal/whatsapp/reconnect');
}

export async function whatsappSendMessage(chatId, text) {
    const { messageId } = await callInternal('POST', '/internal/whatsapp/send-message', { chatId, text });
    return messageId;
}

export async function whatsappSendMedia(chatId, mediaPath, caption) {
    return callInternal('POST', '/internal/whatsapp/send-media', { chatId, mediaPath, caption });
}

export default {
    getStatus, reinit, chat, clearChat, broadcast,
    whatsappDisconnect, whatsappReconnect, whatsappSendMessage, whatsappSendMedia,
    reloadSchedules, getHaEntities
};
