import { fetchExchangeRate } from './core/utils.js';
import { initSocket, getSocket } from './core/socket.js';
import { fetchStatus } from './core/status.js';
import { setupChat } from './tabs/chat.js';
import { knowledgeController, skillsController } from './tabs/files.js';
import { loadKeywords, setupKeywords } from './tabs/keywords.js';
import { loadSchedules, setupSchedules } from './tabs/schedules.js';
import { loadReminders, setupReminders } from './tabs/reminders.js';
import { loadHaMappings, setupHa } from './tabs/ha.js';
import { loadSettings, setupSettings } from './tabs/settings.js';
import { loadBackups, loadBackupSettings, setupBackup } from './tabs/backup.js';
import { init as setupLogs } from './tabs/logs.js';

(async function () {
    // 1. Initialize Socket.IO
    initSocket();

    // 2. Setup common elements
    const clearLogsBtn = document.getElementById('clear-logs');
    const btnDisconnectWa = document.getElementById('btn-disconnect-wa');
    const btnReconnectWa = document.getElementById('btn-reconnect-wa');

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            const socket = getSocket();
            if (socket) socket.emit('clear_logs');
        });
    }

    if (btnDisconnectWa) {
        btnDisconnectWa.addEventListener('click', async () => {
            if (confirm('האם אתה בטוח שברצונך להתנתק מ-WhatsApp? נדרש לסרוק QR מחדש כדי להתחבר.')) {
                await fetch('/api/whatsapp/disconnect', { method: 'POST' });
            }
        });
    }

    if (btnReconnectWa) {
        btnReconnectWa.addEventListener('click', async () => {
            await fetch('/api/whatsapp/reconnect', { method: 'POST' });
        });
    }

    const btnRestart = document.getElementById('btn-restart');
    if (btnRestart) {
        btnRestart.addEventListener('click', async () => {
            if (!confirm('האם אתה בטוח שברצונך להפעיל מחדש את המערכת?')) return;
            btnRestart.disabled = true;
            btnRestart.textContent = '...מפעיל מחדש';
            try {
                await fetch('/api/restart', { method: 'POST' });
                setTimeout(() => {
                    const poll = setInterval(async () => {
                        try {
                            const res = await fetch('/health');
                            if (res.ok) { clearInterval(poll); window.location.reload(); }
                        } catch {}
                    }, 2000);
                }, 3000);
            } catch {
                btnRestart.disabled = false;
                btnRestart.textContent = '🔄 הפעל מחדש';
            }
        });
    }

    // 3. Setup Tabs (Event Listeners & Lazy Loading)
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const loadedTabs = new Set();
    const tabLoaders = {};

    function activateTab(targetTab, btn) {
        tabBtns.forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');

        tabPanes.forEach(p => p.classList.remove('active'));
        const pane = document.getElementById(targetTab);
        if (pane) pane.classList.add('active');

        if (!loadedTabs.has(targetTab) && tabLoaders[targetTab]) {
            loadedTabs.add(targetTab);
            tabLoaders[targetTab]();
        }
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => activateTab(btn.dataset.tab, btn));
    });

    // Register loaders
    tabLoaders['tab-knowledge'] = () => knowledgeController.loadFiles();
    tabLoaders['tab-skills'] = () => skillsController.loadFiles();
    tabLoaders['tab-keywords'] = () => loadKeywords();
    tabLoaders['tab-scheduled-prompts'] = () => loadSchedules();
    tabLoaders['tab-reminders'] = () => loadReminders();
    tabLoaders['tab-settings'] = () => loadSettings();
    tabLoaders['tab-homeassistant'] = () => loadHaMappings();
    tabLoaders['tab-backup'] = () => { loadBackups(); loadBackupSettings(); };

    // Reload hooks for specific tabs when clicked again
    document.querySelector('[data-tab="tab-reminders"]')?.addEventListener('click', () => {
        if (loadedTabs.has('tab-reminders')) loadReminders();
    });
    document.querySelector('[data-tab="tab-backup"]')?.addEventListener('click', () => {
        if (loadedTabs.has('tab-backup')) {
            loadBackups();
            loadBackupSettings();
        }
    });

    // 4. Setup functionality per tab
    setupChat();
    setupKeywords();
    setupSchedules();
    setupReminders();
    setupHa();
    setupSettings();
    setupBackup();
    setupLogs();

    // 5. Initial fetches
    await fetchExchangeRate();
    fetchStatus();
    setInterval(fetchStatus, 30000);

    // Load data that is needed globally/immediately
    loadReminders();
    loadSettings();
})();
