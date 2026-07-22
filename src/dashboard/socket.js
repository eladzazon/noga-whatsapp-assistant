import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import internalApi from './internalApiClient.js';

// How often to poll the orchestrator for WhatsApp connection/QR state and re-emit to connected
// browsers (Block 5 Phase 1 — no push channel exists between the two processes yet; Phase 2's
// Redis wa:status/wa:qr channels replace this polling loop with real-time push).
const WHATSAPP_STATUS_POLL_MS = 3000;

export default function setupSocketIO(io, deps) {
    const { logger, subscribeToLogs, getRecentLogs } = deps;

    // Authentication middleware for Socket.IO
    io.use((socket, next) => {
        // In production, you'd verify the session here
        next();
    });

    io.on('connection', async (socket) => {
        logger.debug('Dashboard client connected', { id: socket.id });

        // Send current QR code if available
        try {
            const { whatsapp } = await internalApi.getStatus();
            if (whatsapp.qrDataUrl) socket.emit('qr', whatsapp.qrDataUrl);
        } catch (err) {
            logger.debug('Orchestrator unreachable for initial QR check', { error: err.message });
        }

        // Send recent logs
        socket.emit('logs', getRecentLogs(50));

        // Dashboard Chat: Receive message from dashboard
        socket.on('dashboard_message', async (text) => {
            try {
                const response = await internalApi.chat(text);
                socket.emit('dashboard_response', { text: response });
            } catch (err) {
                socket.emit('dashboard_response', { error: err.message });
            }
        });

        // Dashboard Chat: Clear history
        socket.on('clear_chat', async () => {
            try {
                await internalApi.clearChat();
                socket.emit('chat_cleared');
            } catch (err) {
                logger.warn('Failed to clear chat via orchestrator', { error: err.message });
            }
        });

        socket.on('disconnect', () => {
            logger.debug('Dashboard client disconnected', { id: socket.id });
        });
    });

    // Poll the orchestrator for WhatsApp state and re-broadcast to every connected browser
    // whenever it changes — see WHATSAPP_STATUS_POLL_MS comment above.
    let lastQrDataUrl = null;
    let lastIsReady = null;
    setInterval(async () => {
        try {
            const { whatsapp } = await internalApi.getStatus();
            if (whatsapp.qrDataUrl && whatsapp.qrDataUrl !== lastQrDataUrl) {
                io.emit('qr', whatsapp.qrDataUrl);
            }
            if (whatsapp.isReady && !lastIsReady) {
                io.emit('qr', null);
                io.emit('connected');
            }
            lastQrDataUrl = whatsapp.qrDataUrl;
            lastIsReady = whatsapp.isReady;
        } catch (err) {
            // Orchestrator unreachable this tick — skip silently, retry next interval.
        }
    }, WHATSAPP_STATUS_POLL_MS);

    // Subscribe to log events and broadcast
    subscribeToLogs((logEntry) => {
        io.emit('log', logEntry);
    });

    // Setup file watching for live updates (debounced to avoid duplicate events)
    const debounce = (fn, delay) => {
        const timers = {};
        return (eventType, filename) => {
            const key = `${eventType}:${filename}`;
            clearTimeout(timers[key]);
            timers[key] = setTimeout(() => fn(eventType, filename), delay);
        };
    };

    const watchDir = (dirPath, fileType) => {
        if (!fs.existsSync(dirPath)) return;
        fs.watch(dirPath, debounce((eventType, filename) => {
            if (filename && filename.endsWith('.md')) {
                io.emit('file_changed', { type: fileType, filename, eventType });
            }
        }, 300));
    };

    const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge', config.tenantId);
    const skillsDir = path.resolve(process.cwd(), 'data', 'skills', config.tenantId);

    watchDir(knowledgeDir, 'knowledge');
    watchDir(skillsDir, 'skills');
}
