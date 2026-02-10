// Dashboard Socket.IO Client

(function () {
    // Connect to Socket.IO
    const socket = io();

    // Elements
    const statusBadge = document.getElementById('status-badge');
    const qrPlaceholder = document.getElementById('qr-placeholder');
    const consoleEl = document.getElementById('console');
    const clearLogsBtn = document.getElementById('clear-logs');

    // Status elements
    const statusElements = {
        whatsapp: document.getElementById('status-whatsapp'),
        gemini: document.getElementById('status-gemini'),
        calendar: document.getElementById('status-calendar'),
        tasks: document.getElementById('status-tasks'),
        homeassistant: document.getElementById('status-homeassistant')
    };

    // Socket.IO Events
    socket.on('connect', () => {
        console.log('Connected to dashboard server');
        fetchStatus();
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from dashboard server');
        updateStatusBadge('מנותק', 'disconnected');
    });

    // QR Code events
    socket.on('qr', (qrDataUrl) => {
        if (qrDataUrl) {
            qrPlaceholder.innerHTML = `<img src="${qrDataUrl}" alt="QR Code" class="qr-image">`;
            updateStatusBadge('ממתין לסריקה', 'disconnected');
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
        fetchStatus();
    });

    socket.on('disconnected', (reason) => {
        updateStatusBadge('מנותק', 'disconnected');
        addLogEntry({
            level: 'warn',
            message: `WhatsApp disconnected: ${reason}`,
            timestamp: new Date().toISOString()
        });
    });

    // Log events
    socket.on('log', (logEntry) => {
        addLogEntry(logEntry);
    });

    socket.on('logs', (logs) => {
        // Clear and add all logs
        consoleEl.innerHTML = '';
        logs.forEach(addLogEntry);
    });

    // Functions
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

        // Auto-scroll to bottom
        consoleEl.scrollTop = consoleEl.scrollHeight;

        // Limit entries
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
    }

    async function fetchStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();

            // Update WhatsApp status
            if (data.whatsapp) {
                updateStatusItem('whatsapp', data.whatsapp.isReady);
                if (data.whatsapp.isReady) {
                    updateStatusBadge('מחובר', 'connected');
                }
            }

            // Update Gemini status
            if (data.gemini) {
                updateStatusItem('gemini', data.gemini.isInitialized);
            }

            // Update skills status
            if (data.skills) {
                updateStatusItem('calendar', data.skills.calendar?.available);
                updateStatusItem('tasks', data.skills.tasks?.available);
                updateStatusItem('homeassistant', data.skills.homeAssistant?.available);
            }
        } catch (err) {
            console.error('Failed to fetch status:', err);
        }
    }

    // Clear logs button
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            consoleEl.innerHTML = '';
        });
    }

    // Fetch status periodically
    setInterval(fetchStatus, 30000);

    // Initial status fetch
    fetchStatus();
})();
