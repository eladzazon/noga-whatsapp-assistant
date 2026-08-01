import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Thin client the admin-portal process uses to reach two internal APIs for anything that depends
 * on live in-memory state elsewhere: the orchestrator's (src/internal/server.js — Gemini status,
 * dashboard chat, reinit, schedule reload, HA entities) and, as of Block 5 Phase 2,
 * whatsapp-connector's own (src/internal/whatsappConnectorServer.js — the 4 WhatsApp-control
 * actions, which need a synchronous request/response that doesn't fit orchestrator relay).
 */
async function callApi(baseUrl, secret, method, path, body) {
    const url = `${baseUrl}${path}`;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': secret
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

const callInternal = (method, path, body) =>
    callApi(config.internal.orchestratorUrl, config.internal.secret, method, path, body);

const callWhatsappConnector = (method, path, body) =>
    callApi(config.whatsappConnector.internalUrl, config.whatsappConnector.secret, method, path, body);

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
    return callWhatsappConnector('POST', '/internal/disconnect');
}

export async function whatsappReconnect() {
    return callWhatsappConnector('POST', '/internal/reconnect');
}

export async function whatsappSendMessage(chatId, text) {
    const { messageId } = await callWhatsappConnector('POST', '/internal/send-message', { chatId, text });
    return messageId;
}

export async function whatsappSendMedia(chatId, mediaPath, caption) {
    return callWhatsappConnector('POST', '/internal/send-media', { chatId, mediaPath, caption });
}

export default {
    getStatus, reinit, chat, clearChat, broadcast,
    whatsappDisconnect, whatsappReconnect, whatsappSendMessage, whatsappSendMedia,
    reloadSchedules, getHaEntities
};
