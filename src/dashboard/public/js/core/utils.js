// Utilities and common UI elements

// ==================== HTML Escaping ====================
export function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function escapeAttr(str) {
    if (str == null) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/"/g, '&quot;');
}

// ==================== Modal Functions ====================
export function showConfirmModal(title, message) {
    return new Promise((resolve) => {
        const confirmModal = document.getElementById('confirm-modal');
        const confirmModalTitle = document.getElementById('confirm-modal-title');
        const confirmModalMessage = document.getElementById('confirm-modal-message');
        const confirmModalOk = document.getElementById('confirm-modal-ok');
        const confirmModalCancel = document.getElementById('confirm-modal-cancel');

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

// ==================== Currency Formatting ====================
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

// ==================== Status & Logs ====================
export function updateStatusBadge(text, status) {
    const statusBadge = document.getElementById('status-badge');
    if (statusBadge) {
        statusBadge.textContent = text;
        statusBadge.className = `status-badge ${status}`;
    }
}

export function addLogEntry(log) {
    const consoleEl = document.getElementById('console');
    if (!consoleEl) return;

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
