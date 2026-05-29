import { escapeHtml, escapeAttr, showConfirmModal } from '../core/utils.js';

function setupFileEditor(type) {
    const fileList = document.getElementById(`${type}-file-list`);
    const editor = document.getElementById(type === 'knowledge' ? 'knowledge-editor' : 'skill-editor');
    const filenameSpan = document.getElementById(`current-${type}-filename`);
    const addBtn = document.getElementById(`add-${type}-file`);
    const saveBtn = document.getElementById(`save-${type}`);
    const deleteBtn = document.getElementById(`delete-${type}-file`);
    const statusEl = document.getElementById(`${type}-status`);
    const apiPath = type === 'knowledge' ? '/api/knowledge' : '/api/skills';

    let currentFile = null;
    let filesData = [];

    async function loadFiles() {
        try {
            const res = await fetch(apiPath);
            const data = await res.json();
            filesData = data.files || [];
            renderFileList();

            // Update the open editor if the file content changed remotely
            if (currentFile) {
                const fileObj = filesData.find(f => f.name === currentFile);
                if (fileObj && editor.value !== fileObj.content) {
                    editor.value = fileObj.content;
                }
            }
        } catch (err) {
            console.error(`Failed to load ${type} files:`, err);
        }
    }

    function renderFileList() {
        if (!fileList) return;
        fileList.innerHTML = filesData.map(f => `
            <li class="file-item ${currentFile === f.name ? 'active' : ''}" data-name="${escapeAttr(f.name)}" style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px;">
                📄 <span>${escapeHtml(f.name)}</span>
            </li>
        `).join('');

        // Add click listeners
        fileList.querySelectorAll('.file-item').forEach(el => {
            el.addEventListener('click', () => {
                selectFile(el.dataset.name);
            });
        });
    }

    function selectFile(filename) {
        currentFile = filename;
        const fileObj = filesData.find(f => f.name === filename);
        if (fileObj) {
            editor.value = fileObj.content;
            editor.disabled = false;
            if (filenameSpan) filenameSpan.textContent = filename;
            if (deleteBtn) deleteBtn.style.display = 'block';
        }
        renderFileList(); // Update active class
    }

    async function saveFile() {
        if (!currentFile) return;

        const content = editor.value;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = '...שומר';
        }

        try {
            const res = await fetch(`${apiPath}/${currentFile}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await res.json();

            if (data.success) {
                showStatus('נשמר בהצלחה ✓', 'success');
                // Update local data
                const fileObj = filesData.find(f => f.name === currentFile);
                if (fileObj) fileObj.content = content;
            } else {
                showStatus(data.error || 'שגיאה בשמירה', 'error');
            }
        } catch (err) {
            showStatus('שגיאה בשמירה', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'שמור';
            }
        }
    }

    async function deleteFile() {
        if (!currentFile) return;

        const confirmed = await showConfirmModal('מחיקת קובץ', `האם אתה בטוח שברצונך למחוק את הקובץ ${currentFile}?`);
        if (!confirmed) return;

        try {
            const res = await fetch(`${apiPath}/${currentFile}`, { method: 'DELETE' });
            const data = await res.json();

            if (data.success) {
                currentFile = null;
                editor.value = '';
                editor.disabled = true;
                if (filenameSpan) filenameSpan.textContent = 'בחר קובץ';
                if (deleteBtn) deleteBtn.style.display = 'none';
                await loadFiles();
                showStatus('נמחק בהצלחה', 'success');
            }
        } catch (err) {
            showStatus('שגיאה במחיקה', 'error');
        }
    }

    function addFile() {
        let filename = prompt('הכנס שם קובץ חדש (עם סיומת .md):', `new_${type}.md`);
        if (!filename) return;
        if (!filename.endsWith('.md')) filename += '.md';

        if (filesData.some(f => f.name === filename)) {
            alert('קובץ עם שם כזה כבר קיים!');
            return;
        }

        filesData.push({ name: filename, content: '' });
        selectFile(filename);
        editor.focus();
    }

    function showStatus(text, statusType) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = `save-status ${statusType}`;
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'save-status';
        }, 3000);
    }

    // Attach listeners
    if (addBtn) addBtn.addEventListener('click', addFile);
    if (saveBtn) saveBtn.addEventListener('click', saveFile);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteFile);

    return { loadFiles };
}

export const knowledgeController = setupFileEditor('knowledge');
export const skillsController = setupFileEditor('skills');
