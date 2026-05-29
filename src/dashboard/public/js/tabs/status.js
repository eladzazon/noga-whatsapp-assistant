// tabs/status.js — WhatsApp disconnect/reconnect and restart button listeners
import { showConfirmModal, addLogEntry, updateStatusBadge } from '../core.js';

// DOM References
const btnDisconnectWa = document.getElementById('btn-disconnect-wa');
const btnReconnectWa = document.getElementById('btn-reconnect-wa');
const btnRestart = document.getElementById('btn-restart');

// Initialize event listeners
export function init() {
    if (btnDisconnectWa) {
        btnDisconnectWa.addEventListener('click', async () => {
            const confirmed = await showConfirmModal('התנתקות מ-WhatsApp', 'האם אתה בטוח שברצונך להתנתק? תצטרך לסרוק את ה-QR שוב.');
            if (!confirmed) return;

            btnDisconnectWa.disabled = true;
            btnDisconnectWa.textContent = '...מתנתק';

            try {
                const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    addLogEntry({
                        level: 'info',
                        message: 'WhatsApp disconnected manually. Waiting for QR code...',
                        timestamp: new Date().toISOString()
                    });
                } else {
                    alert(data.error || 'שגיאה בניתוק');
                }
            } catch (err) {
                alert('שגיאה בתקשורת מול השרת');
            } finally {
                btnDisconnectWa.disabled = false;
                btnDisconnectWa.textContent = 'התנתק';
            }
        });
    }

    if (btnReconnectWa) {
        btnReconnectWa.addEventListener('click', async () => {
            btnReconnectWa.disabled = true;
            btnReconnectWa.textContent = '...מתחבר';

            try {
                const res = await fetch('/api/whatsapp/reconnect', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    addLogEntry({
                        level: 'info',
                        message: 'Reconnecting WhatsApp. Waiting for QR code...',
                        timestamp: new Date().toISOString()
                    });
                } else {
                    alert(data.error || 'שגיאה בהתחברות מחדש');
                }
            } catch (err) {
                alert('שגיאה בתקשורת מול השרת');
            } finally {
                btnReconnectWa.disabled = false;
                btnReconnectWa.textContent = '🔄 התחבר מחדש';
            }
        });
    }

    if (btnRestart) {
        btnRestart.addEventListener('click', async () => {
            const confirmed = await showConfirmModal('הפעלה מחדש', 'האם אתה בטוח שברצונך להפעיל מחדש את המערכת?');
            if (!confirmed) return;

            btnRestart.disabled = true;
            btnRestart.textContent = '...מפעיל מחדש';

            try {
                await fetch('/api/restart', { method: 'POST' });
                // Show restarting message
                addLogEntry({
                    level: 'warn',
                    message: 'Application restart requested. Reconnecting...',
                    timestamp: new Date().toISOString()
                });
                updateStatusBadge('מאתחל...', 'disconnected');

                // Poll until server comes back
                setTimeout(() => {
                    const poll = setInterval(async () => {
                        try {
                            const res = await fetch('/health');
                            if (res.ok) {
                                clearInterval(poll);
                                window.location.reload();
                            }
                        } catch {
                            // Server still down, keep polling
                        }
                    }, 2000);
                }, 3000);
            } catch (err) {
                btnRestart.disabled = false;
                btnRestart.textContent = '🔄 הפעל מחדש';
                alert('שגיאה בהפעלה מחדש');
            }
        });
    }
}
