import { escapeHtml, escapeAttr, showConfirmModal } from '../core/utils.js';

export async function loadReminders() {
    const remindersTbody = document.getElementById('reminders-tbody');
    try {
        const res = await fetch('/api/reminders');
        const data = await res.json();
        if (data.success) renderReminders(data.reminders);
    } catch (err) {
        console.error('Failed to load reminders:', err);
        if (remindersTbody) remindersTbody.innerHTML = '<tr class="empty-row"><td colspan="5">שגיאה בטעינת תזכורות</td></tr>';
    }
}

function renderReminders(reminders) {
    const remindersTbody = document.getElementById('reminders-tbody');
    if (!remindersTbody) return;
    if (reminders.length === 0) {
        remindersTbody.innerHTML = '<tr class="empty-row"><td colspan="6">אין תזכורות. לחצו "הוסף" כדי להתחיל.</td></tr>';
        return;
    }
    // Compute the effective next-nudge timestamp for sorting
    function getNextNudgeTime(r) {
        const now = new Date();
        const dueDate = new Date(r.due_date);
        if (r.status !== 'pending') return Infinity; // non-pending go to bottom
        if (now < dueDate) return dueDate.getTime(); // first nudge at due date
        if (!r.last_nudged) return 0; // immediate nudge — put at very top
        const nextNudge = new Date(r.last_nudged).getTime() + (r.nudge_interval_minutes * 60000);
        return nextNudge <= now.getTime() ? 0 : nextNudge; // immediate or future
    }

    // Sort: pending first by next nudge ascending, then non-pending by updated_at descending
    const sorted = [...reminders].sort((a, b) => {
        const aPending = a.status === 'pending';
        const bPending = b.status === 'pending';
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        if (aPending && bPending) return getNextNudgeTime(a) - getNextNudgeTime(b);
        // Both non-pending: most recently updated first
        return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });

    remindersTbody.innerHTML = sorted.map(r => {
        const now = new Date();
        const dueDate = new Date(r.due_date);
        const dueDateStr = r.due_date ? dueDate.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '-';
        const nudgedStr = r.last_nudged ? new Date(r.last_nudged).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '-';

        // Calculate Next Nudge
        let nextNudgeStr = '-';
        if (r.status === 'pending') {
            if (now < dueDate) {
                // First nudge at due date
                nextNudgeStr = dueDate.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
            } else {
                // Already overdue
                if (!r.last_nudged) {
                    nextNudgeStr = 'מיידי (בדקה הקרובה)';
                } else {
                    const nextNudgeDate = new Date(new Date(r.last_nudged).getTime() + (r.nudge_interval_minutes * 60000));
                    nextNudgeStr = nextNudgeDate.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
                    if (nextNudgeDate < now) {
                        nextNudgeStr = 'מיידי (בדקה הקרובה)';
                    }
                }
            }
        }

        const isOverdue = r.status === 'pending' && dueDate < now;
        let statusHtml;
        if (r.status === 'done') statusHtml = '<span class="kw-type ai">בוצע</span>';
        else if (r.status === 'cancelled') statusHtml = '<span class="kw-type">מבוטל</span>';
        else if (isOverdue) statusHtml = '<span class="kw-type" style="background:var(--danger);color:#fff;">מעוכב!</span>';
        else statusHtml = '<span class="kw-type" style="background:var(--primary);color:#fff;">בהמתנה</span>';

        return `
        <tr data-id="${r.id}">
            <td class="kw-keyword"><strong>${escapeHtml(r.title)}</strong><br><small style="color:var(--gray)">נדנוד כל ${r.nudge_interval_minutes} דק'</small></td>
            <td><code dir="ltr" style="background:var(--light-bg);padding:2px 6px;border-radius:4px;">${dueDateStr}</code></td>
            <td>${nudgedStr}</td>
            <td><code dir="ltr" style="background:var(--light-bg);padding:2px 6px;border-radius:4px;">${nextNudgeStr}</code></td>
            <td>${statusHtml}</td>
            <td class="kw-actions">
                ${r.status === 'pending' ? `<button class="btn btn-small btn-action" onclick="window._markReminderDone(${r.id})" title="סמן כבוצע">✔️</button>` : ''}
                <button class="btn btn-small btn-action" onclick="window._editReminder(${r.id}, '${escapeAttr(r.title)}', '${r.due_date}', ${r.nudge_interval_minutes})" title="ערוך">✏️</button>
                <button class="btn btn-small btn-action btn-danger-action" onclick="window._deleteReminder(${r.id})" title="מחק">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

export function setupReminders() {
    const addReminderBtn = document.getElementById('add-reminder-btn');
    const reminderCancelBtn = document.getElementById('reminder-cancel');
    const reminderSaveBtn = document.getElementById('reminder-save');

    if (addReminderBtn) addReminderBtn.addEventListener('click', () => showReminderForm());
    if (reminderCancelBtn) reminderCancelBtn.addEventListener('click', hideReminderForm);
    if (reminderSaveBtn) reminderSaveBtn.addEventListener('click', saveReminder);

    window._editReminder = function (id, title, dueDate, interval) {
        // Convert ISO date to local datetime-local format
        const date = new Date(dueDate);
        const tzoffset = (date.getTimezoneOffset() * 60000);
        const localISOTime = (new Date(date - tzoffset)).toISOString().slice(0, 16);

        showReminderForm(id, title, localISOTime, interval);
    };

    window._markReminderDone = async (id) => {
        try {
            await fetch(`/api/reminders/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'done' })
            });
            loadReminders();
        } catch (err) { console.error(err); }
    };

    window._deleteReminder = async (id) => {
        const confirmed = await showConfirmModal('מחיקת תזכורת', 'האם למחוק תזכורת זו? פעולה זו אינה הפיכה.');
        if (!confirmed) return;
        try {
            await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
            loadReminders();
        } catch (err) { console.error(err); }
    };
}

function showReminderForm(id = '', title = '', dueDate = '', interval = 60) {
    const reminderForm = document.getElementById('reminder-form');
    const reminderEditId = document.getElementById('reminder-edit-id');
    const reminderTitle = document.getElementById('reminder-title');
    const reminderDueDate = document.getElementById('reminder-dueDate');
    const reminderInterval = document.getElementById('reminder-interval');

    reminderEditId.value = id;
    reminderTitle.value = title;
    reminderInterval.value = interval;

    // Default due date to 1hr from now if not editing
    if (dueDate) {
        reminderDueDate.value = dueDate;
    } else {
        const now = new Date();
        now.setHours(now.getHours() + 1);
        reminderDueDate.value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    reminderForm.style.display = 'block';
    reminderTitle.focus();
}

function hideReminderForm() {
    const reminderForm = document.getElementById('reminder-form');
    const reminderEditId = document.getElementById('reminder-edit-id');
    const reminderTitle = document.getElementById('reminder-title');
    const reminderDueDate = document.getElementById('reminder-dueDate');
    const reminderInterval = document.getElementById('reminder-interval');

    reminderForm.style.display = 'none';
    reminderEditId.value = '';
    reminderTitle.value = '';
    reminderDueDate.value = '';
    reminderInterval.value = 60;
}

async function saveReminder() {
    const reminderEditId = document.getElementById('reminder-edit-id');
    const reminderTitle = document.getElementById('reminder-title');
    const reminderDueDate = document.getElementById('reminder-dueDate');
    const reminderInterval = document.getElementById('reminder-interval');
    const reminderSaveBtn = document.getElementById('reminder-save');

    const id = reminderEditId.value;
    const title = reminderTitle.value.trim();
    const dueDate = reminderDueDate.value;
    const interval = parseInt(reminderInterval.value) || 60;

    if (!title || !dueDate) { alert('יש למלא תיאור ותאריך יעד'); return; }

    reminderSaveBtn.disabled = true;
    try {
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/reminders/${id}` : '/api/reminders';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, dueDate: new Date(dueDate).toISOString(), nudgeIntervalMinutes: interval })
        });
        const data = await res.json();
        if (data.success || data.id) { hideReminderForm(); loadReminders(); }
        else alert(data.error || 'שגיאה בשמירת תזכורת');
    } catch { alert('שגיאת תקשורת'); }
    finally { reminderSaveBtn.disabled = false; }
}
