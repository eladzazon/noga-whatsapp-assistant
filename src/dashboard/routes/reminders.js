import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';

export default function createRemindersRoutes(deps) {
    const router = Router();
    const { requireAuth, db } = deps;

    // Get all reminders
    router.get('/api/reminders', requireAuth, asyncHandler(async (req, res) => {
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        const reminders = db.getAllReminders();
        res.json({ success: true, reminders });
    }));

    // Add reminder
    router.post('/api/reminders', requireAuth, asyncHandler(async (req, res) => {
        const { title, dueDate, nudgeIntervalMinutes } = req.body;
        if (!title || !dueDate) {
            const err = new Error('Title and due date are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        const id = db.addReminder(title, dueDate, nudgeIntervalMinutes || 60);
        res.json({ success: true, id });
    }));

    // Update reminder details
    router.put('/api/reminders/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { title, dueDate, nudgeIntervalMinutes } = req.body;
        if (!title || !dueDate) {
            const err = new Error('Title and due date are required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        db.updateReminder(parseInt(id), title, dueDate, nudgeIntervalMinutes || 60);
        res.json({ success: true });
    }));

    // Update reminder status
    router.put('/api/reminders/:id/status', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !['pending', 'done', 'cancelled'].includes(status)) {
            const err = new Error('Valid status is required');
            err.statusCode = 400;
            throw err;
        }
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        db.updateReminderStatus(parseInt(id), status);
        res.json({ success: true });
    }));

    // Delete reminder
    router.delete('/api/reminders/:id', requireAuth, asyncHandler(async (req, res) => {
        const { id } = req.params;
        if (!db) {
            const err = new Error('DB not initialized');
            err.statusCode = 500;
            throw err;
        }
        db.deleteReminder(parseInt(id));
        res.json({ success: true });
    }));

    return router;
}
