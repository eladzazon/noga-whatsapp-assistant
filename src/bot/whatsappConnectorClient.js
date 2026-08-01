import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Block 5 Phase 2: narrow exception to "outbound sends go through wa:outgoing pub/sub" — the
 * reminder-nudger (SchedulerManager._runReminderNudgerTick) needs the sent message's ID
 * synchronously to register it for the 👍-reaction completion flow
 * (db.addReminderNudgeMessage/getReminderByNudgeMessageId), which fire-and-forget pub/sub can't
 * provide. Calls whatsapp-connector's own internal API directly instead, the same one
 * admin-portal uses for its synchronous WhatsApp-control actions.
 */
async function callWhatsappConnector(method, path, body) {
    const url = `${config.whatsappConnector.internalUrl}${path}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': config.whatsappConnector.secret },
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `whatsapp-connector internal API returned ${res.status}`);
    return data;
}

export async function sendMessage(chatId, text) {
    const { messageId } = await callWhatsappConnector('POST', '/internal/send-message', { chatId, text });
    return messageId;
}

export default { sendMessage };
