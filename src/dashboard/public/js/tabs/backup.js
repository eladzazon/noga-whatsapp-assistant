import { escapeHtml, showConfirmModal } from '../core/utils.js';

export async function loadBackups() {
    const backupsListContainer = document.getElementById('backups-list-container');
    try {
        const res = await fetch('/api/backups');
        const data = await res.json();
        
        if (!backupsListContainer) return;

        if (!data.backups || data.backups.length === 0) {
            backupsListContainer.innerHTML = '<div style="text-align: center; color: var(--gray); padding: 20px;">אין גיבויים שמורים</div>';
            return;
        }

        backupsListContainer.innerHTML = `
            <div class="data-table-container">
                <table class="data-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th>שם קובץ</th>
                            <th>תאריך יצירה</th>
                            <th>גודל</th>
                            <th style="width: 100px;">פעולות</th>
                        </tr>
                    </thead>
                    <tbody>
                    ${data.backups.map(b => `
                        <tr>
                            <td dir="ltr" style="text-align: left;"><code style="font-size: 12px;">${escapeHtml(b.filename)}</code></td>
                            <td style="font-size: 13px; color: var(--gray);">${new Date(b.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</td>
                            <td>${b.size < 1024 * 1024 ? (b.size / 1024).toFixed(1) + ' KB' : (b.size / (1024 * 1024)).toFixed(1) + ' MB'}</td>
                            <td class="kw-actions">
                                <a href="/api/backups/${encodeURIComponent(b.filename)}/download" class="btn btn-small btn-action" title="הורד" download>⬇️</a>
                                <button class="btn btn-small btn-action btn-danger-action" onclick="window._deleteBackup('${escapeHtml(b.filename)}')" title="מחק">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        if (backupsListContainer) backupsListContainer.innerHTML = '<div style="color: var(--danger); text-align: center; padding: 20px;">שגיאה בטעינת גיבויים</div>';
    }
}

export async function loadBackupSettings() {
    try {
        const res = await fetch('/api/backup-settings');
        const data = await res.json();
        if (data && data.retention) {
            const el = document.getElementById('backup-retention');
            if (el) el.value = data.retention;
        }
    } catch (err) {
        console.error('Failed to load backup settings', err);
    }
}

export function setupBackup() {
    const btnCreateBackup = document.getElementById('btn-create-backup');
    const btnSaveBackupSettings = document.getElementById('btn-save-backup-settings');
    const btnRestore = document.getElementById('btn-restore');
    const backupStatus = document.getElementById('backup-status');
    const restoreStatus = document.getElementById('restore-status');

    function showBackupStatus(text, statusType) {
        if (!backupStatus) return;
        backupStatus.textContent = text;
        backupStatus.className = `save-status ${statusType}`;
        setTimeout(() => {
            backupStatus.textContent = '';
            backupStatus.className = 'save-status';
        }, 5000);
    }

    if (btnCreateBackup) {
        btnCreateBackup.addEventListener('click', async () => {
            btnCreateBackup.disabled = true;
            btnCreateBackup.textContent = '...מגבה';
            showBackupStatus('מכין גיבוי...', '');

            try {
                const res = await fetch('/api/backups/create', { method: 'POST' });
                const data = await res.json();
                
                if (data.success) {
                    showBackupStatus('גיבוי נוצר בהצלחה ✓', 'success');
                    loadBackups();
                } else {
                    showBackupStatus(data.error || 'שגיאה ביצירת גיבוי', 'error');
                }
            } catch (err) {
                showBackupStatus('שגיאה בתקשורת', 'error');
            } finally {
                btnCreateBackup.disabled = false;
                btnCreateBackup.textContent = '➕ צור גיבוי עכשיו';
            }
        });
    }

    if (btnSaveBackupSettings) {
        btnSaveBackupSettings.addEventListener('click', async () => {
            const val = parseInt(document.getElementById('backup-retention')?.value);
            const retention = isNaN(val) ? 7 : val;
            if (retention < 0 || retention > 30) {
                showBackupStatus('הגדרת גיבוי חייבת להיות בין 0 ל-30', 'error');
                return;
            }
            try {
                const res = await fetch('/api/backup-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ retention })
                });
                const data = await res.json();
                showBackupStatus(data.success ? 'נשמר ✓' : (data.error || 'שגיאה'), data.success ? 'success' : 'error');
            } catch { showBackupStatus('שגיאה בשמירה', 'error'); }
        });
    }

    if (btnRestore) {
        btnRestore.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const confirmed = await showConfirmModal('שחזור מגיבוי', 'אזהרה: שחזור ידרוס את קבצי הידע, המיומנויות, מילות המפתח ועוד. להמשיך?');
            if (!confirmed) { e.target.value = ''; return; }

            if (restoreStatus) { restoreStatus.textContent = 'משחזר...'; restoreStatus.style.color = 'var(--primary)'; }

            try {
                const text = await file.text();
                const json = JSON.parse(text);
                const res = await fetch('/api/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(json)
                });
                const data = await res.json();
                if (restoreStatus) {
                    restoreStatus.textContent = data.success ? 'שוחזר בהצלחה ✓' : (data.error || 'שגיאה בשחזור');
                    restoreStatus.style.color = data.success ? 'var(--success)' : 'var(--danger)';
                }
            } catch {
                if (restoreStatus) { restoreStatus.textContent = 'קובץ גיבוי לא תקין'; restoreStatus.style.color = 'var(--danger)'; }
            }

            setTimeout(() => { if (restoreStatus) restoreStatus.textContent = ''; }, 5000);
            e.target.value = '';
        });
    }

    window._deleteBackup = async function(filename) {
        const confirmed = await showConfirmModal('מחיקת גיבוי', `האם למחוק את קובץ הגיבוי ${filename}?`);
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                loadBackups();
            } else {
                alert(data.error || 'שגיאה במחיקה');
            }
        } catch {
            alert('שגיאה במחיקה');
        }
    };
}
