import { Router } from 'express';

export default function createRemindersRoutes(deps) {
    const router = Router();
    const { requireAuth, db } = deps;

    // Get all reminders
    router.get('/api/reminders', requireAuth, (req, res) => {
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            const reminders = db.getAllReminders();
            res.json({ success: true, reminders });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Add reminder
    router.post('/api/reminders', requireAuth, (req, res) => {
        const { title, dueDate, nudgeIntervalMinutes } = req.body;
        if (!title || !dueDate) {
            return res.status(400).json({ error: 'Title and due date are required' });
        }
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            const id = db.addReminder(title, dueDate, nudgeIntervalMinutes || 60);
            res.json({ success: true, id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update reminder details
    router.put('/api/reminders/:id', requireAuth, (req, res) => {
        const { id } = req.params;
        const { title, dueDate, nudgeIntervalMinutes } = req.body;
        if (!title || !dueDate) {
            return res.status(400).json({ error: 'Title and due date are required' });
        }
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            db.updateReminder(parseInt(id), title, dueDate, nudgeIntervalMinutes || 60);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Update reminder status
    router.put('/api/reminders/:id/status', requireAuth, (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !['pending', 'done', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'Valid status is required' });
        }
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            db.updateReminderStatus(parseInt(id), status);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Delete reminder
    router.delete('/api/reminders/:id', requireAuth, (req, res) => {
        const { id } = req.params;
        if (!db) return res.status(500).json({ error: 'DB not initialized' });
        try {
            db.deleteReminder(parseInt(id));
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}
