import { escapeHtml, escapeAttr, showConfirmModal } from '../core/utils.js';

let allTenants = [];
let defaultTenantId = null;

export async function loadTenants() {
    const tbody = document.getElementById('tenants-tbody');
    try {
        const res = await fetch('/api/tenants');
        const data = await res.json();
        allTenants = data.profiles || [];
        defaultTenantId = data.defaultTenantId;
        renderTenants(allTenants);
    } catch (err) {
        console.error('Failed to load tenants:', err);
        if (tbody) tbody.innerHTML = '<tr class="empty-row"><td colspan="7">שגיאה בטעינת רשימת הדיירים</td></tr>';
    }
}

function renderTenants(tenants) {
    const tbody = document.getElementById('tenants-tbody');
    if (!tbody) return;

    if (tenants.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">אין קבוצות רשומות עדיין.</td></tr>';
        return;
    }

    tbody.innerHTML = tenants.map(t => {
        const statusBadge = t.enabled
            ? '<span class="status-badge connected">מאושר</span>'
            : '<span class="status-badge disconnected">ממתין לאישור</span>';
        const isDefault = t.tenant_id === defaultTenantId;
        const actions = t.enabled
            ? `<button class="btn btn-small btn-action" onclick="window._editTenant('${escapeAttr(t.tenant_id)}')">✏️ ערוך פרטים</button>`
            : `
                <button class="btn btn-small btn-primary" onclick="window._editTenant('${escapeAttr(t.tenant_id)}')">✅ אשר</button>
                <button class="btn btn-small btn-action btn-danger-action" onclick="window._rejectTenant('${escapeAttr(t.tenant_id)}')">🗑️ דחה</button>
              `;
        return `
        <tr data-tenant-id="${escapeAttr(t.tenant_id)}">
            <td><strong>${escapeHtml(t.display_name || t.tenant_id)}</strong>${isDefault ? ' <span class="type-badge">ברירת מחדל</span>' : ''}</td>
            <td dir="ltr" style="font-size: 11px; color: var(--gray);">${escapeHtml(t.group_jid || '-')}</td>
            <td>${statusBadge}</td>
            <td>${t.ha_url ? '✅' : '—'}</td>
            <td>${t.google_calendar_id ? '✅' : '—'}</td>
            <td style="font-size: 11px; color: var(--gray);">${t.created_at ? new Date(t.created_at).toLocaleDateString('he-IL') : '-'}</td>
            <td class="kw-actions">${actions}</td>
        </tr>
        `;
    }).join('');
}

/**
 * Populates the header's tenant selector (always visible, not gated by tab visibility) and
 * wires switching. Session-based (Block 4 Phase 2) — changes req.session.tenantId, which the
 * dashboard's tenantContext middleware already reads; only the display tenant changes, WhatsApp
 * message routing is unaffected.
 */
export async function initTenantSelector() {
    const selector = document.getElementById('tenant-selector');
    if (!selector) return;

    try {
        const res = await fetch('/api/tenants');
        const data = await res.json();
        const approved = (data.profiles || []).filter(t => t.enabled);

        if (approved.length <= 1) {
            // Nothing to switch between yet — hide rather than show a useless single-option select
            selector.style.display = 'none';
            return;
        }

        selector.innerHTML = approved.map(t =>
            `<option value="${escapeAttr(t.tenant_id)}">${escapeHtml(t.display_name || t.tenant_id)}</option>`
        ).join('');
        selector.value = data.selectedTenantId;

        selector.addEventListener('change', async () => {
            try {
                await fetch('/api/session/tenant', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tenantId: selector.value })
                });
                window.location.reload();
            } catch (err) {
                alert('שגיאה במעבר בין דיירים');
            }
        });
    } catch (err) {
        console.error('Failed to load tenant selector:', err);
        selector.style.display = 'none';
    }
}

export function setupTenants() {
    const saveBtn = document.getElementById('tenant-approve-save');
    const cancelBtn = document.getElementById('tenant-approve-cancel');

    if (saveBtn) saveBtn.addEventListener('click', saveTenantApproval);
    if (cancelBtn) cancelBtn.addEventListener('click', hideApproveForm);

    window._editTenant = function (tenantId) {
        const tenant = allTenants.find(t => t.tenant_id === tenantId);
        if (!tenant) return;
        showApproveForm(tenant);
    };

    window._rejectTenant = async function (tenantId) {
        const confirmed = await showConfirmModal('דחיית קבוצה', 'האם אתה בטוח שברצונך לדחות ולמחוק קבוצה זו?');
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/tenants/${tenantId}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'שגיאה בדחיית הקבוצה');
                return;
            }
            loadTenants();
        } catch (err) {
            alert('שגיאה בתקשורת מול השרת');
        }
    };
}

function showApproveForm(tenant) {
    const form = document.getElementById('tenant-approve-form');
    if (!form) return;
    document.getElementById('tenant-approve-id').value = tenant.tenant_id;
    document.getElementById('tenant-display-name').value = tenant.display_name || '';
    document.getElementById('tenant-ha-url').value = tenant.ha_url || '';
    document.getElementById('tenant-ha-token').value = '';
    document.getElementById('tenant-calendar-id').value = tenant.google_calendar_id || '';
    form.style.display = 'block';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideApproveForm() {
    const form = document.getElementById('tenant-approve-form');
    if (!form) return;
    form.style.display = 'none';
}

async function saveTenantApproval() {
    const id = document.getElementById('tenant-approve-id').value;
    const displayName = document.getElementById('tenant-display-name').value.trim();
    const haUrl = document.getElementById('tenant-ha-url').value.trim();
    const haToken = document.getElementById('tenant-ha-token').value.trim();
    const googleCalendarId = document.getElementById('tenant-calendar-id').value.trim();

    if (!id) return;

    try {
        const res = await fetch(`/api/tenants/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                displayName: displayName || undefined,
                haUrl: haUrl || undefined,
                haToken: haToken || undefined,
                googleCalendarId: googleCalendarId || undefined
            })
        });
        if (!res.ok) {
            alert('שגיאה באישור הקבוצה');
            return;
        }
        hideApproveForm();
        loadTenants();
    } catch (err) {
        alert('שגיאה בתקשורת מול השרת');
    }
}
