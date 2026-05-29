export async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.settings) {
            Object.keys(data.settings).forEach(key => {
                const el = document.getElementById(key);
                if (el) el.value = data.settings[key];
            });
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

export function setupSettings() {
    const saveSettingsBtn = document.getElementById('save-settings');
    const settingsStatusEl = document.getElementById('settings-status');

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            saveSettingsBtn.disabled = true;
            saveSettingsBtn.textContent = '...שומר';

            const payload = {};
            document.querySelectorAll('.settings-panel input, .settings-panel select, .settings-panel textarea').forEach(el => {
                if (el.id && el.value !== undefined) {
                    payload[el.id] = el.value;
                }
            });

            try {
                const res = await fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (data.success) {
                    showStatus('נשמר בהצלחה ✓', 'success');
                } else {
                    showStatus(data.error || 'שגיאה בשמירה', 'error');
                }
            } catch (err) {
                showStatus('שגיאה בשמירה', 'error');
            } finally {
                saveSettingsBtn.disabled = false;
                saveSettingsBtn.textContent = 'שמור שינויים';
            }
        });
    }

    function showStatus(text, statusType) {
        if (!settingsStatusEl) return;
        settingsStatusEl.textContent = text;
        settingsStatusEl.className = `save-status ${statusType}`;
        setTimeout(() => {
            settingsStatusEl.textContent = '';
            settingsStatusEl.className = 'save-status';
        }, 3000);
    }
}
