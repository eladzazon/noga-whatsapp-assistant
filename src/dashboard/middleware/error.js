import logger from '../../utils/logger.js';

/**
 * Express error-handling middleware
 */
export function errorHandler(err, req, res, next) {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    logger.error('Express API Error', {
        path: req.path,
        method: req.method,
        status: statusCode,
        error: err.message,
        stack: err.stack
    });

    if (res.headersSent) {
        return next(err);
    }

    res.status(statusCode).json({
        error: message
    });
}

/**
 * Async wrapper to capture promise rejections in Express routes and pass to next()
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
