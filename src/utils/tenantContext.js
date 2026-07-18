import { AsyncLocalStorage } from 'node:async_hooks';
import config from './config.js';
import logger from './logger.js';

const storage = new AsyncLocalStorage();

/**
 * Run fn with tenantId bound to the current async context. Everything fn calls (directly or
 * transitively, including callbacks/promises started within it) can read it via getTenantId()
 * without threading tenantId through every function signature.
 */
export function run(tenantId, fn) {
    return storage.run(tenantId, fn);
}

/**
 * Read the tenantId bound by the nearest enclosing run(). Falls back to config.tenantId (the
 * single-tenant default) if called outside any wrapped context, rather than throwing — a missed
 * run() wrapper should degrade to today's single-tenant behavior, not crash the bot. Logged at
 * debug level so unwrapped call sites can be found and fixed.
 */
export function getTenantId() {
    const tenantId = storage.getStore();
    if (tenantId === undefined) {
        logger.debug('[tenantContext] getTenantId() called outside a run() context — falling back to config.tenantId');
        return config.tenantId;
    }
    return tenantId;
}

export default { run, getTenantId };
