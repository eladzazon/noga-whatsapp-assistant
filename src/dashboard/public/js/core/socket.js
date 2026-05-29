import { updateStatusBadge, addLogEntry, escapeHtml } from './utils.js';
import { fetchStatus, updateStatusItem } from './status.js';
import { knowledgeController, skillsController } from '../tabs/files.js';

let socket = null;

export function getSocket() {
    return socket;
}

export function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to dashboard server');
        fetchStatus();
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from dashboard server');
        updateStatusBadge('מנותק', 'disconnected');
    });

    socket.on('qr', (qrDataUrl) => {
        const qrPlaceholder = document.getElementById('qr-placeholder');
        const qrSection = document.getElementById('qr-section');
        
        if (qrDataUrl) {
            if (qrPlaceholder) qrPlaceholder.innerHTML = `<img src="${qrDataUrl}" alt="QR Code" class="qr-image">`;
            updateStatusBadge('ממתין לסריקה', 'disconnected');
            if (qrSection) qrSection.classList.remove('hidden');
        }
    });

    socket.on('connected', () => {
        const qrPlaceholder = document.getElementById('qr-placeholder');
        const qrSection = document.getElementById('qr-section');
        
        if (qrPlaceholder) {
            qrPlaceholder.innerHTML = `
                <div class="connected-message">
                    <span class="checkmark">✓</span>
                    <p>WhatsApp מחובר!</p>
                </div>
            `;
        }
        updateStatusBadge('מחובר', 'connected');
        if (qrSection) qrSection.classList.add('hidden');
        fetchStatus();
    });

    socket.on('disconnected', (reason) => {
        const qrPlaceholder = document.getElementById('qr-placeholder');
        const qrSection = document.getElementById('qr-section');

        updateStatusBadge('מנותק', 'disconnected');
        updateStatusItem('whatsapp', false, 'מנותק');
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
        const consoleEl = document.getElementById('console');
        if (consoleEl) consoleEl.innerHTML = '';
        logs.forEach(addLogEntry);
    });

    socket.on('file_changed', (data) => {
        console.log('File changed remotely:', data);
        if (data.type === 'knowledge' && knowledgeController) {
            knowledgeController.loadFiles();
        } else if (data.type === 'skills' && skillsController) {
            skillsController.loadFiles();
        }
    });

    return socket;
}
