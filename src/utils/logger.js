import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
);

// Custom format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat
        })
    ]
});

// Always write to file (not just production)
const logsDir = path.join('data', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });


logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: fileFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5
}));

logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: fileFormat,
    maxsize: 5242880,
    maxFiles: 5
}));

// In-memory log buffer for dashboard streaming
const logBuffer = [];
const MAX_BUFFER_SIZE = 200;
const logListeners = new Set();

// Override logger methods to capture logs for streaming
const originalLog = logger.log.bind(logger);
logger.log = function (level, message, ...meta) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level: typeof level === 'string' ? level : level.level,
        message: typeof level === 'string' ? message : level.message,
        meta: typeof level === 'string' ? meta[0] : {}
    };

    // Add to buffer
    logBuffer.push(logEntry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift();
    }

    // Notify listeners
    for (const listener of logListeners) {
        try {
            listener(logEntry);
        } catch (err) {
            // Ignore listener errors
        }
    }

    return originalLog(level, message, ...meta);
};

/**
 * Subscribe to log events
 * @param {Function} callback - Function to call with each log entry
 * @returns {Function} Unsubscribe function
 */
export function subscribeToLogs(callback) {
    logListeners.add(callback);
    return () => logListeners.delete(callback);
}

/**
 * Get recent logs from buffer
 * @param {number} count - Number of logs to retrieve
 */
export function getRecentLogs(count = 50) {
    return logBuffer.slice(-count);
}

/**
 * Read the last N lines from the combined server log file.
 * Falls back to in-memory buffer if the file doesn't exist yet.
 * @param {number} lines - Number of lines to retrieve
 */
export function readServerLogs(lines = 50) {
    const logFile = path.join('data', 'logs', 'combined.log');
    try {
        if (!fs.existsSync(logFile)) return getRecentLogs(lines);
        const content = fs.readFileSync(logFile, 'utf-8');
        const rawLines = content.trim().split('\n').filter(Boolean);
        return rawLines
            .slice(-lines)
            .map(line => {
                try {
                    const entry = JSON.parse(line);
                    return {
                        timestamp: entry.timestamp,
                        level: entry.level,
                        message: entry.message
                    };
                } catch {
                    return { timestamp: '', level: 'info', message: line };
                }
            });
    } catch {
        return getRecentLogs(lines);
    }
}

export default logger;
