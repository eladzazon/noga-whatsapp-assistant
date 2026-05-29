// core.js — shared utilities and state

// Socket.IO (loaded globally by <script src="/socket.io/socket.io.js">)
export const socket = io();

// === DOM References ===
const statusBadge = document.getElementById('status-badge');
const qrPlaceholder = document.getElementById('qr-placeholder');
const qrSection = document.getElementById('qr-section');
const consoleEl = document.getElementById('console');
const clearLogsBtn = document.getElementById('clear-logs');
const btnDisconnectWa = document.getElementById('btn-disconnect-wa');
const btnReconnectWa = document.getElementById('btn-reconnect-wa');

// Status elements
const statusElements = {
    whatsapp: document.getElementById('status-whatsapp'),
    gemini: document.getElementById('status-gemini'),
    calendar: document.getElementById('status-calendar'),
    homeassistant: document.getElementById('status-homeassistant')
};

// ==================== Modal Functions ====================
const confirmModal = document.getElementById('confirm-modal');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmModalOk = document.getElementById('confirm-modal-ok');
const confirmModalCancel = document.getElementById('confirm-modal-cancel');

export function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        if (!confirmModal) {
            // Fallback if modal doesn't exist
            resolve(confirm(`${title}\n\n${message}`));
            return;
        }

        confirmModalTitle.textContent = title;
        confirmModalMessage.textContent = message;
        confirmModal.style.display = 'flex';

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };

        const cleanup = () => {
            confirmModal.style.display = 'none';
            confirmModalOk.removeEventListener('click', onOk);
            confirmModalCancel.removeEventListener('click', onCancel);
        };

        confirmModalOk.addEventListener('click', onOk);
        confirmModalCancel.addEventListener('click', onCancel);
    });
}

// === DOM Utilities ===

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function escapeAttr(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/"/g, '&quot;');
}

// === Exchange Rate ===

let usdToIlsRate = 3.65; // Fallback rate

export async function fetchExchangeRate() {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if (data && data.rates && data.rates.ILS) {
            usdToIlsRate = data.rates.ILS;
            console.log(`Updated USD to ILS rate: ${usdToIlsRate}`);
        }
    } catch (err) {
        console.error('Failed to fetch exchange rate:', err);
    }
}

export function formatCost(cost) {
    return new Intl.NumberFormat('he-IL', {
        style: 'currency',
        currency: 'ILS',
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
    }).format(cost * usdToIlsRate);
}

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// === Tab Navigation ===

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

export const loadedTabs = new Set();
export const tabLoaders = {};

export function activateTab(targetTab, btn) {
    // Update buttons
    tabBtns.forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Update panes
    tabPanes.forEach(p => p.classList.remove('active'));
    const pane = document.getElementById(targetTab);
    if (pane) pane.classList.add('active');

    // Lazy-load tab data on first visit
    if (!loadedTabs.has(targetTab) && tabLoaders[targetTab]) {
        loadedTabs.add(targetTab);
        tabLoaders[targetTab]();
    }
}

// Set up tab button click listeners
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab, btn));
});

// === Status Functions ===

export function updateStatusBadge(text, status) {
    statusBadge.textContent = text;
    statusBadge.className = `status-badge ${status}`;
}

export function addLogEntry(log) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${log.level}`;

    const time = new Date(log.timestamp).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem' });

    entry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-level">${log.level.toUpperCase()}</span>
        <span class="log-message">${escapeHtml(log.message)}</span>
    `;

    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;

    while (consoleEl.children.length > 200) {
        consoleEl.removeChild(consoleEl.firstChild);
    }
}

export function updateStatusItem(id, connected, label) {
    const el = statusElements[id];
    if (!el) return;

    const valueEl = el.querySelector('.status-value');
    if (valueEl) {
        valueEl.className = `status-value ${connected ? 'connected' : 'disconnected'}`;
        valueEl.textContent = label || (connected ? 'פעיל' : 'לא פעיל');
    }

    // Handle disconnect/reconnect button visibility for WhatsApp
    if (id === 'whatsapp') {
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
                // Hide QR section if already connected
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
            document.getElementById('usage-today-input').textContent = (data.usage.today.input || 0).toLocaleString();
            document.getElementById('usage-today-output').textContent = (data.usage.today.output || 0).toLocaleString();
            document.getElementById('usage-today-cost').textContent = formatCost(data.usage.today.cost || 0);

            // Update Month's Usage
            document.getElementById('usage-month-input').textContent = (data.usage.month.input || 0).toLocaleString();
            document.getElementById('usage-month-output').textContent = (data.usage.month.output || 0).toLocaleString();
            document.getElementById('usage-month-cost').textContent = formatCost(data.usage.month.cost || 0);
        }
    } catch (err) {
        console.error('Failed to fetch status:', err);
    }
}

// === Socket Events (status, QR, logs) ===

socket.on('connect', () => {
    console.log('Connected to dashboard server');
    fetchStatus();
});

socket.on('disconnect', () => {
    console.log('Disconnected from dashboard server');
    updateStatusBadge('מנותק', 'disconnected');
});

socket.on('qr', (qrDataUrl) => {
    if (qrDataUrl) {
        qrPlaceholder.innerHTML = `<img src="${qrDataUrl}" alt="QR Code" class="qr-image">`;
        updateStatusBadge('ממתין לסריקה', 'disconnected');
        // Show QR section when QR code is available
        if (qrSection) qrSection.classList.remove('hidden');
    }
});

socket.on('connected', () => {
    qrPlaceholder.innerHTML = `
        <div class="connected-message">
            <span class="checkmark">✓</span>
            <p>WhatsApp מחובר!</p>
        </div>
    `;
    updateStatusBadge('מחובר', 'connected');
    // Hide QR section after successful connection
    if (qrSection) qrSection.classList.add('hidden');
    fetchStatus();
});

socket.on('disconnected', (reason) => {
    updateStatusBadge('מנותק', 'disconnected');
    updateStatusItem('whatsapp', false, 'מנותק');
    // Show QR section again when disconnected and reset QR placeholder
    if (qrSection) qrSection.classList.remove('hidden');
    if (qrPlaceholder) {
        qrPlaceholder.innerHTML = `
            <div class="connected-message">
                <p>WhatsApp מנותק</p>
                <p style="font-size: 14px; color: var(--gray);">לחצו על "🔄 התחבר מחדש" למעלה כדי לקבל קוד QR חדש</p>
            </div>
        `;
    }
    addLogEntry({
        level: 'warn',
        message: `WhatsApp disconnected: ${reason}`,
        timestamp: new Date().toISOString()
    });
});

socket.on('log', (logEntry) => {
    addLogEntry(logEntry);
});

socket.on('logs', (logs) => {
    consoleEl.innerHTML = '';
    logs.forEach(addLogEntry);
});

// Clear logs button
if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', () => {
        consoleEl.innerHTML = '';
    });
}
