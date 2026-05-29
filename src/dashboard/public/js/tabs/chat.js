import { getSocket } from '../core/socket.js';
import { showConfirmModal } from '../core/utils.js';

export function setupChat() {
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    const chatMessages = document.getElementById('chat-messages');
    const clearChatBtn = document.getElementById('clear-chat-btn');

    if (!chatInput || !chatSendBtn || !chatMessages) return;

    function addMessage(text, isUser = false) {
        const msgEl = document.createElement('div');
        msgEl.className = `message ${isUser ? 'user-message' : 'noga-message'}`;
        msgEl.textContent = text;
        chatMessages.appendChild(msgEl);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return msgEl;
    }

    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Add user message to UI
        addMessage(text, true);
        chatInput.value = '';

        // Show typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.textContent = 'נוגה חושבת...';
        chatMessages.appendChild(typingIndicator);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Send to server
        const socket = getSocket();
        if (socket) socket.emit('dashboard_message', text);
    }

    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmModal('ניקוי שיחה', 'האם אתה בטוח שברצונך למחוק את היסטוריית השיחה בצ\'אט זה?');
            if (confirmed) {
                const socket = getSocket();
                if (socket) socket.emit('clear_chat');
            }
        });
    }

    // Since socket is initialized in main.js, we expect setupChat to be called after socket is connected.
    const socket = getSocket();
    if (socket) {
        socket.on('dashboard_response', (data) => {
            // Remove typing indicator
            const indicators = chatMessages.querySelectorAll('.typing-indicator');
            indicators.forEach(i => i.remove());

            if (data.error) {
                const errorMsg = addMessage(`שגיאה: ${data.error}`);
                errorMsg.style.color = 'var(--danger)';
            } else {
                addMessage(data.text);
            }
        });

        socket.on('chat_cleared', () => {
            chatMessages.innerHTML = `
                <div class="message noga-message">השיחה נוקתה. איך אני יכולה לעזור מחדש? 😊</div>
            `;
        });
    }
}
