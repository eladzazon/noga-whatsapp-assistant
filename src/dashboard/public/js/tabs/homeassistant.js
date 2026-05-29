// tabs/homeassistant.js — Home Assistant mappings management
import { escapeHtml, escapeAttr, showConfirmModal } from '../core.js';

// DOM References
const addHaMappingBtn = document.getElementById('add-ha-mapping-btn');
const fetchHaEntitiesBtn = document.getElementById('fetch-ha-entities-btn');
const haMappingForm = document.getElementById('ha-mapping-form');
const haMappingEditId = document.getElementById('ha-mapping-edit-id');
const haEntityIdInput = document.getElementById('ha-entity-id');
const haNicknameInput = document.getElementById('ha-nickname');
const haLocationInput = document.getElementById('ha-location');
const haTypeInput = document.getElementById('ha-type');
const haMappingSaveBtn = document.getElementById('ha-mapping-save');
const haMappingCancelBtn = document.getElementById('ha-mapping-cancel');
const haMappingsTbody = document.getElementById('ha-mappings-tbody');
const haDiscoverySection = document.getElementById('ha-discovery-section');
const haEntitiesTbody = document.getElementById('ha-entities-tbody');
const haEntitiesFilter = document.getElementById('ha-entities-filter');

let allHaEntities = []; // Cache for filtering

async function loadHaMappings() {
    try {
        const res = await fetch('/api/ha/mappings');
        const data = await res.json();
        renderHaMappings(data.mappings || []);
    } catch (err) {
        console.error('Failed to load HA mappings:', err);
        if (haMappingsTbody) haMappingsTbody.innerHTML = '<tr class="empty-row"><td colspan="5">שגיאה בטעינת מיפויים</td></tr>';
    }
}

function renderHaMappings(mappings) {
    if (!haMappingsTbody) return;
    if (mappings.length === 0) {
        haMappingsTbody.innerHTML = '<tr class="empty-row"><td colspan="5">אין מיפויים. לחצו "הוסף מיפוי" או "טען מכשירים" כדי להתחיל.</td></tr>';
        return;
    }

    haMappingsTbody.innerHTML = mappings.map(m => {
        let typeIcon = '⚙️';
        switch (m.type) {
            case 'light': typeIcon = '💡'; break;
            case 'switch': typeIcon = '🔌'; break;
            case 'sensor': typeIcon = '🌡️'; break;
            case 'climate': typeIcon = '❄️'; break;
        }
        return `
        <tr data-id="${m.id}">
            <td class="kw-keyword"><code dir="ltr">${escapeHtml(m.entity_id)}</code></td>
            <td><strong>${escapeHtml(m.nickname)}</strong></td>
            <td>${escapeHtml(m.location || '-')}</td>
            <td>${typeIcon} ${escapeHtml(m.type || 'other')}</td>
            <td class="kw-actions">
                <button class="btn btn-small btn-action" onclick="window._editHaMapping(${m.id}, '${escapeAttr(m.entity_id)}', '${escapeAttr(m.nickname)}', '${escapeAttr(m.location || '')}', '${m.type || 'other'}')">✏️</button>
                <button class="btn btn-small btn-action btn-danger-action" onclick="window._deleteHaMapping(${m.id})">🗑️</button>
            </td>
        </tr>
        `;
    }).join('');
}

async function fetchHaEntities() {
    if (haDiscoverySection) haDiscoverySection.style.display = 'block';
    if (haEntitiesTbody) haEntitiesTbody.innerHTML = '<tr><td style="text-align: center; padding: 20px;">...טוען מכשירים מ-Home Assistant</td></tr>';

    try {
        const res = await fetch('/api/ha/entities');
        const data = await res.json();

        if (data.error) {
            if (haEntitiesTbody) haEntitiesTbody.innerHTML = `<tr><td style="text-align: center; padding: 20px; color: var(--danger);">שגיאה: ${escapeHtml(data.error)}</td></tr>`;
            return;
        }

        allHaEntities = data.entities || [];
        renderHaEntitiesList(allHaEntities);
    } catch (err) {
        if (haEntitiesTbody) haEntitiesTbody.innerHTML = '<tr><td style="text-align: center; padding: 20px; color: var(--danger);">שגיאה בתקשורת מול השרת</td></tr>';
    }
}

function renderHaEntitiesList(entities) {
    if (!haEntitiesTbody) return;

    if (entities.length === 0) {
        haEntitiesTbody.innerHTML = '<tr><td style="text-align: center; padding: 20px;">לא נמצאו מכשירים.</td></tr>';
        return;
    }

    haEntitiesTbody.innerHTML = entities.map(e => `
        <tr style="cursor: pointer; hover: background: rgba(0,0,0,0.05);" onclick="window._selectHaEntity('${escapeAttr(e.id)}', '${escapeAttr(e.name)}', '${e.type}')">
            <td dir="ltr" style="font-size: 11px; width: 40%; color: var(--gray);">${escapeHtml(e.id)}</td>
            <td style="width: 50%;"><strong>${escapeHtml(e.name)}</strong></td>
            <td style="width: 10%; text-align: left;"><span class="type-badge">${escapeHtml(e.type)}</span></td>
        </tr>
    `).join('');
}

function showHaMappingForm(id = '', entityId = '', nickname = '', location = '', type = 'light') {
    if (!haMappingForm) return;
    haMappingEditId.value = id;
    haEntityIdInput.value = entityId;
    haNicknameInput.value = nickname;
    haLocationInput.value = location;
    haTypeInput.value = type;
    haMappingForm.style.display = 'block';
    haNicknameInput.focus();
}

function hideHaMappingForm() {
    if (!haMappingForm) return;
    haMappingForm.style.display = 'none';
    haMappingEditId.value = '';
    haEntityIdInput.value = '';
    haNicknameInput.value = '';
    haLocationInput.value = '';
    haTypeInput.value = 'light';
}

async function saveHaMapping() {
    const id = haMappingEditId.value;
    const entityId = haEntityIdInput.value.trim();
    const nickname = haNicknameInput.value.trim();
    const location = haLocationInput.value.trim();
    const type = haTypeInput.value;

    if (!entityId || !nickname) {
        alert('יש למלא מזהה מכשיר וכינוי');
        return;
    }

    if (haMappingSaveBtn) haMappingSaveBtn.disabled = true;

    try {
        let res;
        const payload = { entityId, nickname, location, type };
        if (id) {
            res = await fetch(`/api/ha/mappings/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/ha/mappings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        const data = await res.json();
        if (data.success || data.id) {
            hideHaMappingForm();
            loadHaMappings();
        } else {
            alert(data.error || 'שגיאה בשמירת מיפוי');
        }
    } catch (err) {
        alert('שגיאה בשמירה');
    } finally {
        if (haMappingSaveBtn) haMappingSaveBtn.disabled = false;
    }
}

// Global handlers for Home Assistant
window._selectHaEntity = function (id, name, type) {
    showHaMappingForm('', id, name, '', type === 'switch' || type === 'light' || type === 'sensor' || type === 'climate' ? type : 'other');
    window.scrollTo({ top: haMappingForm.offsetTop - 100, behavior: 'smooth' });
};

window._editHaMapping = function (id, entityId, nickname, location, type) {
    showHaMappingForm(id, entityId, nickname, location, type);
};

window._deleteHaMapping = async function (id) {
    const confirmed = await showConfirmModal('מחיקת מיפוי', 'האם אתה בטוח שברצונך למחוק מיפוי זה?');
    if (!confirmed) return;
    try {
        await fetch(`/api/ha/mappings/${id}`, { method: 'DELETE' });
        loadHaMappings();
    } catch (err) {
        alert('שגיאה במחיקה');
    }
};

// Initialize event listeners
export function init() {
    if (addHaMappingBtn) {
        addHaMappingBtn.addEventListener('click', () => showHaMappingForm());
    }

    if (fetchHaEntitiesBtn) {
        fetchHaEntitiesBtn.addEventListener('click', fetchHaEntities);
    }

    if (haMappingSaveBtn) {
        haMappingSaveBtn.addEventListener('click', saveHaMapping);
    }

    if (haMappingCancelBtn) {
        haMappingCancelBtn.addEventListener('click', hideHaMappingForm);
    }

    // Debounced HA entity filter (200ms delay prevents re-render on every keystroke)
    let _haFilterTimer = null;
    if (haEntitiesFilter) {
        haEntitiesFilter.addEventListener('input', (e) => {
            clearTimeout(_haFilterTimer);
            _haFilterTimer = setTimeout(() => {
                const query = e.target.value.toLowerCase();
                const filtered = allHaEntities.filter(ent =>
                    ent.id.toLowerCase().includes(query) ||
                    ent.name.toLowerCase().includes(query)
                );
                renderHaEntitiesList(filtered);
            }, 200);
        });
    }
}

// Export the load function for tabLoaders
export { loadHaMappings };
