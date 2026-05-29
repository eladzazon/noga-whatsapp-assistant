import { escapeHtml, escapeAttr, showConfirmModal } from '../core/utils.js';

export async function loadSchedules() {
    const schedulesTbody = document.getElementById('schedules-tbody');
    try {
        const res = await fetch('/api/scheduled-prompts');
        const data = await res.json();
        renderSchedules(data.prompts || []);
    } catch (err) {
        console.error('Failed to load schedules:', err);
        if (schedulesTbody) schedulesTbody.innerHTML = '<tr class="empty-row"><td colspan="5">שגיאה בטעינת תזמונים</td></tr>';
    }
}

function renderSchedules(prompts) {
    const schedulesTbody = document.getElementById('schedules-tbody');
    if (!schedulesTbody) return;

    if (prompts.length === 0) {
        schedulesTbody.innerHTML = '<tr class="empty-row"><td colspan="5">אין פעולות מתוזמנות. לחצו "הוסף" כדי להתחיל.</td></tr>';
        return;
    }

    schedulesTbody.innerHTML = prompts.map(p => `
        <tr data-id="${p.id}">
            <td class="kw-keyword">${escapeHtml(p.name)}</td>
            <td><code dir="ltr">${escapeHtml(p.cron_expression)}</code></td>
            <td class="kw-response">${escapeHtml(p.prompt).substring(0, 50)}${p.prompt.length > 50 ? '...' : ''}</td>
            <td>
                <label class="toggle-switch">
                    <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="window._toggleSchedule(${p.id}, '${escapeAttr(p.name)}', '${escapeAttr(p.cron_expression)}', '${escapeAttr(p.prompt)}', this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </td>
            <td class="kw-actions">
                <button class="btn btn-small btn-action" onclick="window._editSchedule(${p.id}, '${escapeAttr(p.name)}', '${escapeAttr(p.cron_expression)}', '${escapeAttr(p.prompt)}')">✏️</button>
                <button class="btn btn-small btn-action btn-danger-action" onclick="window._deleteSchedule(${p.id})">🗑️</button>
            </td>
        </tr>
    `).join('');
}

export function setupSchedules() {
    const addScheduleBtn = document.getElementById('add-schedule-btn');
    const scheduleCancelBtn = document.getElementById('schedule-cancel');
    const scheduleSaveBtn = document.getElementById('schedule-save');

    if (addScheduleBtn) addScheduleBtn.addEventListener('click', () => showScheduleForm());
    if (scheduleCancelBtn) scheduleCancelBtn.addEventListener('click', hideScheduleForm);
    if (scheduleSaveBtn) scheduleSaveBtn.addEventListener('click', saveSchedule);

    // Global functions
    window._editSchedule = function (id, name, cron, prompt) {
        showScheduleForm(id, name, cron, prompt.replace(/\\n/g, '\n'));
    };

    window._deleteSchedule = async function (id) {
        const confirmed = await showConfirmModal('מחיקת תזמון', 'האם אתה בטוח שברצונך למחוק תזמון זה?');
        if (!confirmed) return;
        try {
            await fetch(`/api/scheduled-prompts/${id}`, { method: 'DELETE' });
            loadSchedules();
        } catch (err) {
            alert('שגיאה במחיקה');
        }
    };

    window._toggleSchedule = async function (id, name, cron, prompt, enabled) {
        try {
            await fetch(`/api/scheduled-prompts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, cronExpression: cron, prompt: prompt.replace(/\\n/g, '\n'), enabled })
            });
        } catch (err) {
            alert('שגיאה בעדכון');
            loadSchedules();
        }
    };
}

function showScheduleForm(id = '', name = '', cron = '', prompt = '') {
    const scheduleForm = document.getElementById('schedule-form');
    const scheduleEditId = document.getElementById('schedule-edit-id');
    const scheduleName = document.getElementById('schedule-name');
    const scheduleCron = document.getElementById('schedule-cron');
    const schedulePrompt = document.getElementById('schedule-prompt');

    if (!scheduleForm) return;

    scheduleEditId.value = id;
    scheduleName.value = name;
    scheduleCron.value = cron;
    schedulePrompt.value = prompt;
    scheduleForm.style.display = 'block';
    scheduleName.focus();
}

function hideScheduleForm() {
    const scheduleForm = document.getElementById('schedule-form');
    const scheduleEditId = document.getElementById('schedule-edit-id');
    const scheduleName = document.getElementById('schedule-name');
    const scheduleCron = document.getElementById('schedule-cron');
    const schedulePrompt = document.getElementById('schedule-prompt');

    if (!scheduleForm) return;

    scheduleForm.style.display = 'none';
    scheduleEditId.value = '';
    scheduleName.value = '';
    scheduleCron.value = '';
    schedulePrompt.value = '';
}

async function saveSchedule() {
    const scheduleEditId = document.getElementById('schedule-edit-id');
    const scheduleName = document.getElementById('schedule-name');
    const scheduleCron = document.getElementById('schedule-cron');
    const schedulePrompt = document.getElementById('schedule-prompt');
    const scheduleSaveBtn = document.getElementById('schedule-save');

    const id = scheduleEditId.value;
    const name = scheduleName.value.trim();
    const cron = scheduleCron.value.trim();
    const prompt = schedulePrompt.value.trim();

    if (!name || !cron || !prompt) {
        alert('יש למלא שם, הגדרת CRON ותיאור משימה');
        return;
    }

    if (scheduleSaveBtn) scheduleSaveBtn.disabled = true;

    try {
        let res;
        if (id) {
            res = await fetch(`/api/scheduled-prompts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, cronExpression: cron, prompt })
            });
        } else {
            res = await fetch('/api/scheduled-prompts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, cronExpression: cron, prompt })
            });
        }

        const data = await res.json();
        if (data.success || data.id) {
            hideScheduleForm();
            loadSchedules();
        } else {
            alert(data.error || 'שגיאה בשמירה');
        }
    } catch (err) {
        alert('שגיאה בשמירה');
    } finally {
        if (scheduleSaveBtn) scheduleSaveBtn.disabled = false;
    }
}
