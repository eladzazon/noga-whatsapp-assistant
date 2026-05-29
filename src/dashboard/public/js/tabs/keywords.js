import { escapeHtml, escapeAttr, showConfirmModal } from '../core/utils.js';

export async function loadKeywords() {
    const keywordsTbody = document.getElementById('keywords-tbody');
    try {
        const res = await fetch('/api/keywords');
        const data = await res.json();
        renderKeywords(data.keywords || []);
    } catch (err) {
        console.error('Failed to load keywords:', err);
        if (keywordsTbody) keywordsTbody.innerHTML = '<tr class="empty-row"><td colspan="5">שגיאה בטעינת מילות מפתח</td></tr>';
    }
}

function renderKeywords(keywords) {
    const keywordsTbody = document.getElementById('keywords-tbody');
    if (!keywordsTbody) return;

    if (keywords.length === 0) {
        keywordsTbody.innerHTML = '<tr class="empty-row"><td colspan="5">אין מילות מפתח. לחצו "הוסף" כדי להתחיל.</td></tr>';
        return;
    }

    keywordsTbody.innerHTML = keywords.map(kw => {
        const typeLabel = kw.type === 'ai' ? '🤖 AI' : '⚡ סטטי';
        const typeBadgeClass = kw.type === 'ai' ? 'type-badge-ai' : 'type-badge-static';
        return `
        <tr data-id="${kw.id}">
            <td class="kw-keyword">${escapeHtml(kw.keyword)}</td>
            <td><span class="type-badge ${typeBadgeClass}">${typeLabel}</span></td>
            <td class="kw-response">${escapeHtml(kw.response).substring(0, 80)}${kw.response.length > 80 ? '...' : ''}</td>
            <td>
                <label class="toggle-switch">
                    <input type="checkbox" ${kw.enabled ? 'checked' : ''} onchange="window._toggleKeyword(${kw.id}, '${escapeAttr(kw.keyword)}', '${escapeAttr(kw.response)}', this.checked, '${kw.type || 'static'}')">
                    <span class="toggle-slider"></span>
                </label>
            </td>
            <td class="kw-actions">
                <button class="btn btn-small btn-action" onclick="window._editKeyword(${kw.id}, '${escapeAttr(kw.keyword)}', '${escapeAttr(kw.response)}', '${kw.type || 'static'}')">✏️</button>
                <button class="btn btn-small btn-action btn-danger-action" onclick="window._deleteKeyword(${kw.id})">🗑️</button>
            </td>
        </tr>
        `;
    }).join('');
}

export function setupKeywords() {
    const addKeywordBtn = document.getElementById('add-keyword-btn');
    const keywordCancelBtn = document.getElementById('keyword-cancel');
    const keywordSaveBtn = document.getElementById('keyword-save');

    if (addKeywordBtn) addKeywordBtn.addEventListener('click', () => showKeywordForm());
    if (keywordCancelBtn) keywordCancelBtn.addEventListener('click', hideKeywordForm);
    if (keywordSaveBtn) keywordSaveBtn.addEventListener('click', saveKeyword);

    // Global functions for inline event handlers
    window._editKeyword = function (id, keyword, response, type) {
        showKeywordForm(id, keyword.replace(/\\n/g, '\n'), response.replace(/\\n/g, '\n'), type || 'static');
    };

    window._deleteKeyword = async function (id) {
        const confirmed = await showConfirmModal('מחיקת מילת מפתח', 'האם אתה בטוח שברצונך למחוק מילת מפתח זו?');
        if (!confirmed) return;
        try {
            await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
            loadKeywords();
        } catch (err) {
            alert('שגיאה במחיקה');
        }
    };

    window._toggleKeyword = async function (id, keyword, response, enabled, type) {
        try {
            await fetch(`/api/keywords/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: keyword.replace(/\\n/g, '\n'), response: response.replace(/\\n/g, '\n'), enabled, type: type || 'static' })
            });
        } catch (err) {
            alert('שגיאה בעדכון');
            loadKeywords();
        }
    };
}

function showKeywordForm(id = '', keyword = '', response = '', type = 'static') {
    const keywordForm = document.getElementById('keyword-form');
    const keywordEditId = document.getElementById('keyword-edit-id');
    const keywordInput = document.getElementById('keyword-input');
    const keywordResponse = document.getElementById('keyword-response');
    const keywordType = document.getElementById('keyword-type');

    if (!keywordForm) return;

    keywordEditId.value = id;
    keywordInput.value = keyword;
    keywordResponse.value = response;
    keywordType.value = type;
    updateFormLabels(type);
    keywordForm.style.display = 'block';
    keywordInput.focus();
}

function updateFormLabels(type) {
    const keywordResponseLabel = document.getElementById('keyword-response-label');
    const keywordResponse = document.getElementById('keyword-response');

    if (!keywordResponseLabel || !keywordResponse) return;

    if (type === 'ai') {
        keywordResponseLabel.textContent = 'הוראות ל-AI';
        keywordResponse.placeholder = 'הוראות מותאמות עבור Gemini, למשל: תן סטטוס של כל התאורה בבית לפי חדרים';
    } else {
        keywordResponseLabel.textContent = 'תגובה';
        keywordResponse.placeholder = 'התגובה שתישלח כשהמילה תתקבל';
    }
}

function hideKeywordForm() {
    const keywordForm = document.getElementById('keyword-form');
    const keywordEditId = document.getElementById('keyword-edit-id');
    const keywordInput = document.getElementById('keyword-input');
    const keywordResponse = document.getElementById('keyword-response');
    const keywordType = document.getElementById('keyword-type');

    if (!keywordForm) return;

    keywordForm.style.display = 'none';
    keywordEditId.value = '';
    keywordInput.value = '';
    keywordResponse.value = '';
    keywordType.value = 'static';
}

async function saveKeyword() {
    const keywordEditId = document.getElementById('keyword-edit-id');
    const keywordInput = document.getElementById('keyword-input');
    const keywordResponse = document.getElementById('keyword-response');
    const keywordType = document.getElementById('keyword-type');
    const keywordSaveBtn = document.getElementById('keyword-save');

    const id = keywordEditId.value;
    const keyword = keywordInput.value.trim();
    const response = keywordResponse.value.trim();
    const type = keywordType.value;

    if (!keyword || !response) {
        alert('יש למלא את מילת המפתח ואת התגובה');
        return;
    }

    if (keywordSaveBtn) keywordSaveBtn.disabled = true;

    try {
        let res;
        if (id) {
            res = await fetch(`/api/keywords/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword, response, type })
            });
        } else {
            res = await fetch('/api/keywords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword, response, type })
            });
        }

        const data = await res.json();
        if (data.success || data.id) {
            hideKeywordForm();
            loadKeywords();
        } else {
            alert(data.error || 'שגיאה בשמירה');
        }
    } catch (err) {
        alert('שגיאה בשמירה');
    } finally {
        if (keywordSaveBtn) keywordSaveBtn.disabled = false;
    }
}
