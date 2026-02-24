// Dashboard Socket.IO Client

(function () {
    // Connect to Socket.IO
    const socket = io();

    // Elements
    const statusBadge = document.getElementById('status-badge');
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const qrSection = document.getElementById('qr-section');
    const consoleEl = document.getElementById('console');
    const clearLogsBtn = document.getElementById('clear-logs');
    const btnDisconnectWa = document.getElementById('btn-disconnect-wa');
    const btnReconnectWa = document.getElementById('btn-reconnect-wa');

    // Status elements
    const statusElements = {
        whatsapp: document.getElementById('status-whatsapp'),
        gemini: document.getElementById('status-gemini'),
        calendar: document.getElementById('status-calendar'),
        tasks: document.getElementById('status-tasks'),
        homeassistant: document.getElementById('status-homeassistant')
    };

    // System Prompt elements
    const systemPromptEl = document.getElementById('system-prompt');
    const savePromptBtn = document.getElementById('save-prompt');
    const promptStatusEl = document.getElementById('prompt-status');

    // Keywords elements
    const addKeywordBtn = document.getElementById('add-keyword-btn');
    const keywordForm = document.getElementById('keyword-form');
    const keywordEditId = document.getElementById('keyword-edit-id');
    const keywordInput = document.getElementById('keyword-input');
    const keywordType = document.getElementById('keyword-type');
    const keywordResponse = document.getElementById('keyword-response');
    const keywordResponseLabel = document.getElementById('keyword-response-label');
    const keywordSaveBtn = document.getElementById('keyword-save');
    const keywordCancelBtn = document.getElementById('keyword-cancel');
    const keywordsTbody = document.getElementById('keywords-tbody');

    // Scheduled Prompts elements
    const addScheduleBtn = document.getElementById('add-schedule-btn');
    const scheduleForm = document.getElementById('schedule-form');
    const scheduleEditId = document.getElementById('schedule-edit-id');
    const scheduleName = document.getElementById('schedule-name');
    const scheduleCron = document.getElementById('schedule-cron');
    const schedulePrompt = document.getElementById('schedule-prompt');
    const scheduleSaveBtn = document.getElementById('schedule-save');
    const scheduleCancelBtn = document.getElementById('schedule-cancel');
    const schedulesTbody = document.getElementById('schedules-tbody');

    // ==================== Tab Navigation ====================

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;

            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update panes
            tabPanes.forEach(p => p.classList.remove('active'));
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // ==================== Socket.IO Events ====================

    socket.on('connect', () => {
        console.log('Connected to dashboard server');
        fetchStatus();
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from dashboard server');
        updateStatusBadge('מנותק', 'disconnected');
    });

    socket.on('qr', (qrDataUrl) => {
        if (qrDataUrl) {
            qrPlaceholder.innerHTML = `<img src="${qrDataUrl}" alt="QR Code" class="qr-image">`;
            updateStatusBadge('ממתין לסריקה', 'disconnected');
            // Show QR section when QR code is available
            if (qrSection) qrSection.classList.remove('hidden');
        }
    });

    socket.on('connected', () => {
        qrPlaceholder.innerHTML = `
            <div class="connected-message">
                <span class="checkmark">✓</span>
                <p>WhatsApp מחובר!</p>
            </div>
        `;
        updateStatusBadge('מחובר', 'connected');
        // Hide QR section after successful connection
        if (qrSection) qrSection.classList.add('hidden');
        fetchStatus();
    });

    socket.on('disconnected', (reason) => {
        updateStatusBadge('מנותק', 'disconnected');
        // Show QR section again when disconnected
        if (qrSection) qrSection.classList.remove('hidden');
        addLogEntry({
            level: 'warn',
            message: `WhatsApp disconnected: ${reason}`,
            timestamp: new Date().toISOString()
        });
    });

    socket.on('log', (logEntry) => {
        addLogEntry(logEntry);
    });

    socket.on('logs', (logs) => {
        consoleEl.innerHTML = '';
        logs.forEach(addLogEntry);
    });

    // ==================== Status Functions ====================

    function updateStatusBadge(text, status) {
        statusBadge.textContent = text;
        statusBadge.className = `status-badge ${status}`;
    }

    function addLogEntry(log) {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${log.level}`;

        const time = new Date(log.timestamp).toLocaleTimeString('he-IL');

        entry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-level">${log.level.toUpperCase()}</span>
            <span class="log-message">${escapeHtml(log.message)}</span>
        `;

        consoleEl.appendChild(entry);
        consoleEl.scrollTop = consoleEl.scrollHeight;

        while (consoleEl.children.length > 200) {
            consoleEl.removeChild(consoleEl.firstChild);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateStatusItem(id, connected, label) {
        const el = statusElements[id];
        if (!el) return;

        const valueEl = el.querySelector('.status-value');
        if (valueEl) {
            valueEl.className = `status-value ${connected ? 'connected' : 'disconnected'}`;
            valueEl.textContent = label || (connected ? 'פעיל' : 'לא פעיל');
        }

        // Handle disconnect/reconnect button visibility for WhatsApp
        if (id === 'whatsapp') {
            if (btnDisconnectWa) {
                btnDisconnectWa.style.display = connected ? 'inline-block' : 'none';
            }
            if (btnReconnectWa) {
                btnReconnectWa.style.display = connected ? 'none' : 'inline-block';
            }
        }
    }

    async function fetchStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            if (data.whatsapp) {
                updateStatusItem('whatsapp', data.whatsapp.isReady);
                if (data.whatsapp.isReady) {
                    updateStatusBadge('מחובר', 'connected');
                    // Hide QR section if already connected
                    if (qrSection) qrSection.classList.add('hidden');
                }
            }

            if (data.gemini) {
                updateStatusItem('gemini', data.gemini.isInitialized);
            }

            if (data.skills) {
                updateStatusItem('calendar', data.skills.calendar?.available);
                updateStatusItem('tasks', data.skills.tasks?.available);
                updateStatusItem('homeassistant', data.skills.homeAssistant?.available);
            }

            if (data.usage) {
                // Update Today's Usage
                document.getElementById('usage-today-input').textContent = (data.usage.today.input || 0).toLocaleString();
                document.getElementById('usage-today-output').textContent = (data.usage.today.output || 0).toLocaleString();
                document.getElementById('usage-today-cost').textContent = formatCost(data.usage.today.cost || 0);

                // Update Month's Usage
                document.getElementById('usage-month-input').textContent = (data.usage.month.input || 0).toLocaleString();
                document.getElementById('usage-month-output').textContent = (data.usage.month.output || 0).toLocaleString();
                document.getElementById('usage-month-cost').textContent = formatCost(data.usage.month.cost || 0);
            }
        } catch (err) {
            console.error('Failed to fetch status:', err);
        }
    }

    // ==================== System Prompt Functions ====================

    async function loadSystemPrompt() {
        try {
            const res = await fetch('/api/system-prompt');
            const data = await res.json();
            if (data.prompt) {
                systemPromptEl.value = data.prompt;
            }
        } catch (err) {
            console.error('Failed to load system prompt:', err);
            systemPromptEl.value = 'שגיאה בטעינת ההוראות';
        }
    }

    async function saveSystemPrompt() {
        const prompt = systemPromptEl.value.trim();
        if (!prompt) {
            showPromptStatus('ההוראות לא יכולות להיות ריקות', 'error');
            return;
        }

        savePromptBtn.disabled = true;
        savePromptBtn.textContent = 'שומר...';

        try {
            const res = await fetch('/api/system-prompt', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });
            const data = await res.json();

            if (data.success) {
                showPromptStatus('נשמר בהצלחה ✓', 'success');
            } else {
                showPromptStatus(data.error || 'שגיאה בשמירה', 'error');
            }
        } catch (err) {
            showPromptStatus('שגיאה בשמירה', 'error');
        } finally {
            savePromptBtn.disabled = false;
            savePromptBtn.textContent = 'שמור';
        }
    }

    function formatCost(cost) {
        return new Intl.NumberFormat('he-IL', {
            style: 'currency',
            currency: 'ILS',
            minimumFractionDigits: 4,
            maximumFractionDigits: 4
        }).format(cost * usdToIlsRate);
    }

    function showPromptStatus(text, type) {
        promptStatusEl.textContent = text;
        promptStatusEl.className = `save-status ${type}`;
        setTimeout(() => {
            promptStatusEl.textContent = '';
            promptStatusEl.className = 'save-status';
        }, 3000);
    }

    // ==================== Keywords Functions ====================

    async function loadKeywords() {
        try {
            const res = await fetch('/api/keywords');
            const data = await res.json();
            renderKeywords(data.keywords || []);
        } catch (err) {
            console.error('Failed to load keywords:', err);
            keywordsTbody.innerHTML = '<tr class="empty-row"><td colspan="5">שגיאה בטעינת מילות מפתח</td></tr>';
        }
    }

    function renderKeywords(keywords) {
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

    function escapeAttr(str) {
        return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/"/g, '&quot;');
    }

    function showKeywordForm(id = '', keyword = '', response = '', type = 'static') {
        keywordEditId.value = id;
        keywordInput.value = keyword;
        keywordResponse.value = response;
        keywordType.value = type;
        updateFormLabels(type);
        keywordForm.style.display = 'block';
        keywordInput.focus();
    }

    function updateFormLabels(type) {
        if (type === 'ai') {
            keywordResponseLabel.textContent = 'הוראות ל-AI';
            keywordResponse.placeholder = 'הוראות מותאמות עבור Gemini, למשל: תן סטטוס של כל התאורה בבית לפי חדרים';
        } else {
            keywordResponseLabel.textContent = 'תגובה';
            keywordResponse.placeholder = 'התגובה שתישלח כשהמילה תתקבל';
        }
    }

    function hideKeywordForm() {
        keywordForm.style.display = 'none';
        keywordEditId.value = '';
        keywordInput.value = '';
        keywordResponse.value = '';
        keywordType.value = 'static';
    }

    async function saveKeyword() {
        const id = keywordEditId.value;
        const keyword = keywordInput.value.trim();
        const response = keywordResponse.value.trim();

        if (!keyword || !response) {
            alert('יש למלא את מילת המפתח ואת התגובה');
            return;
        }

        keywordSaveBtn.disabled = true;

        try {
            let res;
            const type = keywordType.value;
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
            keywordSaveBtn.disabled = false;
        }
    }

    // Global functions for inline event handlers
    window._editKeyword = function (id, keyword, response, type) {
        showKeywordForm(id, keyword.replace(/\\n/g, '\n'), response.replace(/\\n/g, '\n'), type || 'static');
    };

    window._deleteKeyword = async function (id) {
        if (!confirm('למחוק מילת מפתח זו?')) return;
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

    // ==================== Scheduled Prompts Functions ====================

    async function loadSchedules() {
        try {
            const res = await fetch('/api/scheduled-prompts');
            const data = await res.json();
            renderSchedules(data.prompts || []);
        } catch (err) {
            console.error('Failed to load schedules:', err);
            schedulesTbody.innerHTML = '<tr class="empty-row"><td colspan="5">שגיאה בטעינת תזמונים</td></tr>';
        }
    }

    function renderSchedules(prompts) {
        if (prompts.length === 0) {
            schedulesTbody.innerHTML = '<tr class="empty-row"><td colspan="5">אין תזמונים. לחצו "הוסף" כדי להתחיל.</td></tr>';
            return;
        }

        schedulesTbody.innerHTML = prompts.map(p => {
            return `
            <tr data-id="${p.id}">
                <td class="kw-keyword"><strong>${escapeHtml(p.name)}</strong></td>
                <td><code dir="ltr" style="background: var(--light-bg); padding: 2px 6px; border-radius: 4px;">${escapeHtml(p.cron_expression)}</code></td>
                <td class="kw-response">${escapeHtml(p.prompt).substring(0, 80)}${p.prompt.length > 80 ? '...' : ''}</td>
                <td>
                    <label class="toggle-switch">
                        <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="window._toggleSchedule(${p.id}, '${escapeAttr(p.name)}', '${escapeAttr(p.prompt)}', '${escapeAttr(p.cron_expression)}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </td>
                <td class="kw-actions">
                    <button class="btn btn-small btn-action" onclick="window._editSchedule(${p.id}, '${escapeAttr(p.name)}', '${escapeAttr(p.prompt)}', '${escapeAttr(p.cron_expression)}')">✏️</button>
                    <button class="btn btn-small btn-action btn-danger-action" onclick="window._deleteSchedule(${p.id})">🗑️</button>
                </td>
            </tr>
            `;
        }).join('');
    }

    function showScheduleForm(id = '', name = '', prompt = '', cron = '') {
        scheduleEditId.value = id;
        scheduleName.value = name;
        schedulePrompt.value = prompt;
        scheduleCron.value = cron;
        scheduleForm.style.display = 'block';
        scheduleName.focus();
    }

    function hideScheduleForm() {
        scheduleForm.style.display = 'none';
        scheduleEditId.value = '';
        scheduleName.value = '';
        schedulePrompt.value = '';
        scheduleCron.value = '';
    }

    async function saveSchedule() {
        const id = scheduleEditId.value;
        const name = scheduleName.value.trim();
        const prompt = schedulePrompt.value.trim();
        const cronExpression = scheduleCron.value.trim();

        if (!name || !prompt || !cronExpression) {
            alert('יש למלא שם, תזמון, והוראה');
            return;
        }

        scheduleSaveBtn.disabled = true;

        try {
            let res;
            const payload = { name, prompt, cronExpression, enabled: true };
            if (id) {
                res = await fetch(`/api/scheduled-prompts/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch('/api/scheduled-prompts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }

            const data = await res.json();
            if (data.success || data.id) {
                hideScheduleForm();
                loadSchedules();
            } else {
                alert(data.error || 'שגיאה בשמירת תזמון');
            }
        } catch (err) {
            alert('שגיאה בשמירה');
        } finally {
            scheduleSaveBtn.disabled = false;
        }
    }

    // Global functions for inline event handlers (Schedules)
    window._editSchedule = function (id, name, prompt, cron) {
        showScheduleForm(id, name.replace(/\\n/g, '\n'), prompt.replace(/\\n/g, '\n'), cron);
    };

    window._deleteSchedule = async function (id) {
        if (!confirm('למחוק תזמון זה?')) return;
        try {
            await fetch(`/api/scheduled-prompts/${id}`, { method: 'DELETE' });
            loadSchedules();
        } catch (err) {
            alert('שגיאה במחיקה');
        }
    };

    window._toggleSchedule = async function (id, name, prompt, cron, enabled) {
        try {
            await fetch(`/api/scheduled-prompts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.replace(/\\n/g, '\n'),
                    prompt: prompt.replace(/\\n/g, '\n'),
                    cronExpression: cron,
                    enabled
                })
            });
        } catch (err) {
            alert('שגיאה בעדכון');
            loadSchedules();
        }
    };

    // ==================== Event Listeners ====================

    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            consoleEl.innerHTML = '';
        });
    }

    if (btnDisconnectWa) {
        btnDisconnectWa.addEventListener('click', async () => {
            if (!confirm('האם אתה בטוח שברצונך להתנתק מ-WhatsApp? תצטרך לסרוק את ה-QR שוב.')) return;

            btnDisconnectWa.disabled = true;
            btnDisconnectWa.textContent = 'מתנתק...';

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
            btnReconnectWa.textContent = 'מתחבר...';

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

    if (savePromptBtn) {
        savePromptBtn.addEventListener('click', saveSystemPrompt);
    }

    if (addKeywordBtn) {
        addKeywordBtn.addEventListener('click', () => showKeywordForm());
    }

    if (keywordSaveBtn) {
        keywordSaveBtn.addEventListener('click', saveKeyword);
    }

    if (keywordCancelBtn) {
        keywordCancelBtn.addEventListener('click', hideKeywordForm);
    }

    if (keywordType) {
        keywordType.addEventListener('change', () => updateFormLabels(keywordType.value));
    }

    // Schedule listeners
    if (addScheduleBtn) {
        addScheduleBtn.addEventListener('click', () => showScheduleForm());
    }

    if (scheduleSaveBtn) {
        scheduleSaveBtn.addEventListener('click', saveSchedule);
    }

    if (scheduleCancelBtn) {
        scheduleCancelBtn.addEventListener('click', hideScheduleForm);
    }

    // ==================== Initialization ====================

    let usdToIlsRate = 3.65; // Fallback rate

    async function fetchExchangeRate() {
        try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await res.json();
            if (data && data.rates && data.rates.ILS) {
                usdToIlsRate = data.rates.ILS;
                console.log(`Updated USD to ILS rate: ${usdToIlsRate}`);
            }
        } catch (err) {
            console.error('Failed to fetch exchange rate:', err);
        }
    }

    fetchExchangeRate().then(() => {
        fetchStatus();
        setInterval(fetchStatus, 30000);
    });

    loadSystemPrompt();
    loadKeywords();
    loadSchedules();
})();
