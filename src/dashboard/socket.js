import fs from 'fs';
import path from 'path';

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

            try {
                const response = await server.messageRouter.processText('dashboard_admin', text);
                socket.emit('dashboard_response', { text: response });
            } catch (err) {
                socket.emit('dashboard_response', { error: err.message });
            }
        });

        // Dashboard Chat: Clear history
        socket.on('clear_chat', () => {
            if (server.geminiManager) {
                server.geminiManager.clearHistory('dashboard_admin');
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

    const knowledgeDir = path.resolve(process.cwd(), 'data', 'knowledge');
    const skillsDir = path.resolve(process.cwd(), 'data', 'skills');
    
    watchDir(knowledgeDir, 'knowledge');
    watchDir(skillsDir, 'skills');
}
