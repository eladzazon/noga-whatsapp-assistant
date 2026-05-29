import { Router } from 'express';

export function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    res.redirect('/');
}

export default function createAuthRoutes(deps) {
    const router = Router();
    const { config, logger, server } = deps;

    // Login page
    router.get('/', (req, res) => {
        if (req.session && req.session.authenticated) {
            return res.redirect('/dashboard');
        }
        res.render('login', { error: null });
    });

    // Login handler
    router.post('/login', (req, res) => {
        const { username, password } = req.body;

        if (username === config.dashboard.user &&
            password === config.dashboard.password) {
            req.session.authenticated = true;
            logger.info('Dashboard login successful');
            return res.redirect('/dashboard');
        }

        logger.warn('Dashboard login failed', { username });
        res.render('login', { error: 'Invalid credentials' });
    });

    // Logout
    router.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/');
    });

    // Dashboard page
    router.get('/dashboard', requireAuth, (req, res) => {
        res.render('dashboard', {
            qrCode: server.qrCode,
            recentLogs: deps.getRecentLogs(50)
        });
    });

    return router;
}
