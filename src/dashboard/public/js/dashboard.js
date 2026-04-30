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

    // Settings elements
    const saveSettingsBtn = document.getElementById('save-settings');
    const settingsStatusEl = document.getElementById('settings-status');

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

    // Home Assistant elements
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
        updateStatusItem('whatsapp', false, 'מנותק');
        // Show QR section again when disconnected and reset QR placeholder
        if (qrSection) qrSection.classList.remove('hidden');
        if (qrPlaceholder) {
            qrPlaceholder.innerHTML = `
                <div class="connected-message">
                    <p>WhatsApp מנותק</p>
                    <p style="font-size: 14px; color: var(--gray);">לחצו על "🔄 התחבר מחדש" למעלה כדי לקבל קוד QR חדש</p>
                </div>
            `;
        }
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
                const label = data.gemini.quotaExceeded ? 'מכסה נגמרה' : (data.gemini.isInitialized ? 'פעיל' : 'לא פעיל');
                updateStatusItem('gemini', data.gemini.isInitialized && !data.gemini.quotaExceeded, label);
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

    // ==================== Home Assistant Functions ====================

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
        if (haEntitiesTbody) haEntitiesTbody.innerHTML = '<tr><td style="text-align: center; padding: 20px;">טוען מכשירים מ-Home Assistant...</td></tr>';

        try {
            const res = await fetch('/api/ha/entities');
            const data = await res.json();

            if (data.error) {
                if (haEntitiesTbody) haEntitiesTbody.innerHTML = `<tr><td style="text-align: center; padding: 20px; color: var(--danger);">שגיאה: ${escapeHtml(data.error)}</td></tr>`;
                return;
            }

            if (!data.entities || data.entities.length === 0) {
                if (haEntitiesTbody) haEntitiesTbody.innerHTML = '<tr><td style="text-align: center; padding: 20px;">לא נמצאו מכשירים.</td></tr>';
                return;
            }

            if (haEntitiesTbody) {
                haEntitiesTbody.innerHTML = data.entities.map(e => `
                    <tr style="cursor: pointer; hover: background: rgba(0,0,0,0.05);" onclick="window._selectHaEntity('${escapeAttr(e.id)}', '${escapeAttr(e.name)}', '${e.type}')">
                        <td dir="ltr" style="font-size: 11px; width: 40%; color: var(--gray);">${escapeHtml(e.id)}</td>
                        <td style="width: 50%;"><strong>${escapeHtml(e.name)}</strong></td>
                        <td style="width: 10%; text-align: left;"><span class="type-badge">${escapeHtml(e.type)}</span></td>
                    </tr>
                `).join('');
            }
        } catch (err) {
            if (haEntitiesTbody) haEntitiesTbody.innerHTML = '<tr><td style="text-align: center; padding: 20px; color: var(--danger);">שגיאה בתקשורת מול השרת</td></tr>';
        }
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
        if (!confirm('למחוק מיפוי זה?')) return;
        try {
            await fetch(`/api/ha/mappings/${id}`, { method: 'DELETE' });
            loadHaMappings();
        } catch (err) {
            alert('שגיאה במחיקה');
        }
    };

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

    // Home Assistant listeners
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

    // ==================== Restart Button ====================

    const btnRestart = document.getElementById('btn-restart');
    if (btnRestart) {
        btnRestart.addEventListener('click', async () => {
            if (!confirm('האם אתה בטוח שברצונך להפעיל מחדש את המערכת?')) return;

            btnRestart.disabled = true;
            btnRestart.textContent = 'מפעיל מחדש...';

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

    // ==================== Log Sub-Tabs ====================

    const logSubTabs = document.querySelectorAll('.log-sub-tab');
    const logPanes = document.querySelectorAll('.log-pane');

    logSubTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPane = tab.dataset.logTab;

            logSubTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            logPanes.forEach(p => p.classList.remove('active'));
            const pane = document.getElementById(targetPane);
            if (pane) pane.classList.add('active');

            // Auto-fetch server log when switching to it
            if (targetPane === 'server-log') {
                fetchServerLog();
            }
        });
    });

    // ==================== Server Log Functions ====================

    const serverLogConsole = document.getElementById('server-log-console');
    const serverLogInfo = document.getElementById('server-log-info');
    const serverLogLines = document.getElementById('server-log-lines');
    const refreshServerLog = document.getElementById('refresh-server-log');

    async function fetchServerLog() {
        if (!serverLogConsole) return;

        const lines = serverLogLines ? serverLogLines.value : 500;
        serverLogConsole.innerHTML = '<div style="text-align: center; color: var(--gray); padding: 40px;">טוען...</div>';

        try {
            const res = await fetch(`/api/logs/file?lines=${lines}`);
            const data = await res.json();

            if (data.message && (!data.logs || data.logs.length === 0)) {
                serverLogConsole.innerHTML = `<div style="text-align: center; color: var(--gray); padding: 40px;">${escapeHtml(data.message)}</div>`;
                if (serverLogInfo) serverLogInfo.textContent = '';
                return;
            }

            serverLogConsole.innerHTML = '';
            data.logs.forEach(log => {
                const entry = document.createElement('div');
                const level = (log.level || 'info').toLowerCase();
                entry.className = `log-entry log-${level}`;

                const time = log.timestamp ? new Date(log.timestamp).toLocaleString('he-IL') : '';

                // Build message from log fields
                let msg = log.message || '';
                const meta = { ...log };
                delete meta.timestamp;
                delete meta.level;
                delete meta.message;
                if (Object.keys(meta).length > 0) {
                    msg += ' ' + JSON.stringify(meta);
                }

                entry.innerHTML = `
                    <span class="log-time">${time}</span>
                    <span class="log-level">${level.toUpperCase()}</span>
                    <span class="log-message">${escapeHtml(msg)}</span>
                `;
                serverLogConsole.appendChild(entry);
            });

            // Scroll to bottom
            serverLogConsole.scrollTop = serverLogConsole.scrollHeight;

            if (serverLogInfo) {
                serverLogInfo.textContent = `מציג ${data.showing || data.logs.length} מתוך ${data.total || '?'} שורות`;
            }
        } catch (err) {
            serverLogConsole.innerHTML = '<div style="text-align: center; color: var(--danger); padding: 40px;">שגיאה בטעינת לוג השרת</div>';
        }
    }

    if (refreshServerLog) {
        refreshServerLog.addEventListener('click', fetchServerLog);
    }

    if (serverLogLines) {
        serverLogLines.addEventListener('change', fetchServerLog);
    }

    // ==================== Settings Functions ====================

    async function loadSettings() {
        try {
            const res = await fetch('/api/settings');
            const data = await res.json();

            if (data.settings) {
                // Populate all form fields that have data-env attribute
                const fields = document.querySelectorAll('[data-env]');
                fields.forEach(field => {
                    const envKey = field.dataset.env;
                    if (envKey in data.settings) {
                        field.value = data.settings[envKey];
                    }
                });
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    }

    async function saveSettings() {
        const settings = {};
        const fields = document.querySelectorAll('[data-env]');

        fields.forEach(field => {
            const envKey = field.dataset.env;
            const value = field.value;
            // Only include fields that have a value
            if (value !== '') {
                settings[envKey] = value;
            }
        });

        if (Object.keys(settings).length === 0) {
            showSettingsStatus('אין הגדרות לשמור', 'error');
            return;
        }

        saveSettingsBtn.disabled = true;
        saveSettingsBtn.textContent = 'שומר...';

        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings })
            });
            const data = await res.json();

            if (data.success) {
                showSettingsStatus('נשמר בהצלחה ✓ - נדרש הפעלה מחדש', 'success');

                // Ask to restart
                if (confirm('ההגדרות נשמרו! האם להפעיל מחדש את המערכת כעת כדי שהשינויים ייכנסו לתוקף?')) {
                    try {
                        await fetch('/api/restart', { method: 'POST' });
                        updateStatusBadge('מאתחל...', 'disconnected');
                        setTimeout(() => {
                            const poll = setInterval(async () => {
                                try {
                                    const r = await fetch('/health');
                                    if (r.ok) {
                                        clearInterval(poll);
                                        window.location.reload();
                                    }
                                } catch { /* still restarting */ }
                            }, 2000);
                        }, 3000);
                    } catch { /* restart failed */ }
                }
            } else {
                showSettingsStatus(data.error || 'שגיאה בשמירה', 'error');
            }
        } catch (err) {
            showSettingsStatus('שגיאה בשמירה', 'error');
        } finally {
            saveSettingsBtn.disabled = false;
            saveSettingsBtn.textContent = '💾 שמור הגדרות';
        }
    }

    function showSettingsStatus(text, type) {
        settingsStatusEl.textContent = text;
        settingsStatusEl.className = `save-status ${type}`;
        setTimeout(() => {
            settingsStatusEl.textContent = '';
            settingsStatusEl.className = 'save-status';
        }, 5000);
    }

    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveSettings);
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

    fetchExchangeRate();
    fetchStatus();
    setInterval(fetchStatus, 30000);

    loadSystemPrompt();
    loadKeywords();
    loadSchedules();
    loadSettings();
    loadHaMappings();
})();
