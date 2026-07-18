import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import tenantContext from '../utils/tenantContext.js';

export default function setupSocketIO(io, deps) {
    const { logger, server, subscribeToLogs, getRecentLogs } = deps;

    // Authentication middleware for Socket.IO
    io.use((socket, next) => {
        // In production, you'd verify the session here
        next();
    });

    io.on('connection', (socket) => {
        logger.debug('Dashboard client connected', { id: socket.id });

        // Send current QR code if available
        if (server.qrCode) {
            socket.emit('qr', server.qrCode);
        }

        // Send recent logs
        socket.emit('logs', getRecentLogs(50));

        // Dashboard Chat: Receive message from dashboard
        socket.on('dashboard_message', async (text) => {
            if (!server.messageRouter) {
                return socket.emit('dashboard_response', {
                    error: 'Message Router not initialized'
                });
            }

            // Socket.IO events aren't covered by the Express tenantContext middleware — bind it
            // here too. No session-sharing with Socket.IO exists yet (see the placeholder auth
            // middleware above), so this is always config.tenantId today, same as before.
            try {
                const response = await tenantContext.run(config.tenantId, () =>
                    server.messageRouter.processText('dashboard_admin', text)
                );
                socket.emit('dashboard_response', { text: response });
            } catch (err) {
                socket.emit('dashboard_response', { error: err.message });
            }
        });

        // Dashboard Chat: Clear history
        socket.on('clear_chat', () => {
            if (server.geminiManager) {
                tenantContext.run(config.tenantId, () => server.geminiManager.clearHistory('dashboard_admin'));
                socket.emit('chat_cleared');
            }
        });

        socket.on('disconnect', () => {
            logger.debug('Dashboard client disconnected', { id: socket.id });
        });
    });

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
