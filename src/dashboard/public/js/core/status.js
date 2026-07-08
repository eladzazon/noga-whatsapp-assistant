import { updateStatusBadge, formatCost } from './utils.js';

export function updateStatusItem(id, connected, label) {
    const el = document.getElementById(`status-${id}`);
    if (!el) return;

    const valueEl = el.querySelector('.status-value');
    if (valueEl) {
        valueEl.className = `status-value ${connected ? 'connected' : 'disconnected'}`;
        valueEl.textContent = label || (connected ? 'פעיל' : 'לא פעיל');
    }

    // Handle disconnect/reconnect button visibility for WhatsApp
    if (id === 'whatsapp') {
        const btnDisconnectWa = document.getElementById('btn-disconnect-wa');
        const btnReconnectWa = document.getElementById('btn-reconnect-wa');
        if (btnDisconnectWa) {
            btnDisconnectWa.style.display = connected ? 'inline-block' : 'none';
        }
        if (btnReconnectWa) {
            btnReconnectWa.style.display = connected ? 'none' : 'inline-block';
        }
    }
}

export async function fetchStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();

        if (data.whatsapp) {
            updateStatusItem('whatsapp', data.whatsapp.isReady);
            if (data.whatsapp.isReady) {
                updateStatusBadge('מחובר', 'connected');
                const qrSection = document.getElementById('qr-section');
                if (qrSection) qrSection.classList.add('hidden');
            }
        }

        if (data.gemini) {
            const label = data.gemini.quotaExceeded ? 'מכסה נגמרה' : (data.gemini.isInitialized ? 'פעיל' : 'לא פעיל');
            updateStatusItem('gemini', data.gemini.isInitialized && !data.gemini.quotaExceeded, label);
            
            const modelEl = document.getElementById('status-gemini-model');
            if (modelEl && data.gemini.model) {
                modelEl.textContent = data.gemini.model;
            }
        }

        if (data.skills) {
            updateStatusItem('calendar', data.skills.calendar?.available);
            updateStatusItem('homeassistant', data.skills.homeAssistant?.available);
        }

        if (data.usage) {
            // Update Today's Usage
            const usageTodayInput = document.getElementById('usage-today-input');
            const usageTodayOutput = document.getElementById('usage-today-output');
            const usageTodayCost = document.getElementById('usage-today-cost');

            if (usageTodayInput) usageTodayInput.textContent = (data.usage.today.input || 0).toLocaleString();
            if (usageTodayOutput) usageTodayOutput.textContent = (data.usage.today.output || 0).toLocaleString();
            if (usageTodayCost) usageTodayCost.textContent = formatCost(data.usage.today.cost || 0);

            // Update Month's Usage
            const usageMonthInput = document.getElementById('usage-month-input');
            const usageMonthOutput = document.getElementById('usage-month-output');
            const usageMonthCost = document.getElementById('usage-month-cost');

            if (usageMonthInput) usageMonthInput.textContent = (data.usage.month.input || 0).toLocaleString();
            if (usageMonthOutput) usageMonthOutput.textContent = (data.usage.month.output || 0).toLocaleString();
            if (usageMonthCost) usageMonthCost.textContent = formatCost(data.usage.month.cost || 0);
        }
    } catch (err) {
        console.error('Failed to fetch status:', err);
    }
}
