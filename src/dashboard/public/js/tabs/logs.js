// tabs/logs.js — Log sub-tab switching and server log viewer
import { escapeHtml } from '../core/utils.js';
// DOM References
const logSubTabs = document.querySelectorAll('.log-sub-tab');
const logPanes = document.querySelectorAll('.log-pane');
const serverLogConsole = document.getElementById('server-log-console');
const serverLogInfo = document.getElementById('server-log-info');
const serverLogLines = document.getElementById('server-log-lines');
const refreshServerLog = document.getElementById('refresh-server-log');

async function fetchServerLog() {
    if (!serverLogConsole) return;

    const lines = serverLogLines ? serverLogLines.value : 500;
    serverLogConsole.innerHTML = '<div style="text-align: center; color: var(--gray); padding: 40px;">...טוען</div>';

    try {
        const res = await fetch(`/api/logs/file?lines=${lines}`);
        const data = await res.json();

        if (data.message && (!data.logs || data.logs.length === 0)) {
            serverLogConsole.innerHTML = `<div style="text-align: center; color: var(--gray); padding: 40px;">${escapeHtml(data.message)}</div>`;
            if (serverLogInfo) serverLogInfo.textContent = '';
            return;
        }

        serverLogConsole.innerHTML = '';
        data.logs.forEach(log => {
            const entry = document.createElement('div');
            const level = (log.level || 'info').toLowerCase();
            entry.className = `log-entry log-${level}`;

            const time = log.timestamp ? new Date(log.timestamp).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '';

            // Build message from log fields
            let msg = log.message || '';
            const meta = { ...log };
            delete meta.timestamp;
            delete meta.level;
            delete meta.message;
            if (Object.keys(meta).length > 0) {
                msg += ' ' + JSON.stringify(meta);
            }

            entry.innerHTML = `
                <span class="log-time">${time}</span>
                <span class="log-level">${level.toUpperCase()}</span>
                <span class="log-message">${escapeHtml(msg)}</span>
            `;
            serverLogConsole.appendChild(entry);
        });

        // Scroll to bottom
        serverLogConsole.scrollTop = serverLogConsole.scrollHeight;

        if (serverLogInfo) {
            serverLogInfo.textContent = `מציג ${data.showing || data.logs.length} מתוך ${data.total || '?'} שורות`;
        }
    } catch (err) {
        serverLogConsole.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 40px;">שגיאה בטעינת לוג השרת</div>';
    }
}

// Initialize event listeners
export function init() {
    logSubTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPane = tab.dataset.logTab;

            logSubTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            logPanes.forEach(p => p.classList.remove('active'));
            const pane = document.getElementById(targetPane);
            if (pane) pane.classList.add('active');

            // Auto-fetch server log when switching to it
            if (targetPane === 'server-log') {
                fetchServerLog();
            }
        });
    });

    if (refreshServerLog) {
        refreshServerLog.addEventListener('click', fetchServerLog);
    }

    if (serverLogLines) {
        serverLogLines.addEventListener('change', fetchServerLog);
    }
}
