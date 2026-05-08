import { google } from 'googleapis';
import fs from 'fs';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

/**
 * Calendar name aliases → config keys
 * 'main'      → config.google.calendarId          (main/family calendar)
 * 'events'    → config.google.eventsCalendarId     (אירועים חשובים — yearly events)
 * 'birthdays' → config.google.birthdaysCalendarId  (Hebrew birthdays)
 * 'all'       → all three combined
 */
const CALENDAR_MAP = {
    main: () => config.google.calendarId,
    events: () => config.google.eventsCalendarId,
    birthdays: () => config.google.birthdaysCalendarId,
};

const CALENDAR_LABELS = {
    main: '📅 יומן ראשי',
    events: '🎉 אירועים חשובים',
    birthdays: '🎂 ימי הולדת',
};

class CalendarManager {
    constructor() {
        this.calendar = null;
        this.auth = null;
    }

    /**
     * Initialize Google Calendar with Service Account
     */
    async init() {
        try {
            if (!fs.existsSync(config.google.serviceAccountPath)) {
                logger.warn('Google Service Account file not found', {
                    path: config.google.serviceAccountPath
                });
                return this;
            }

            const credentials = JSON.parse(
                fs.readFileSync(config.google.serviceAccountPath, 'utf-8')
            );

            this.auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/calendar']
            });

            this.calendar = google.calendar({ version: 'v3', auth: this.auth });

            logger.info('Google Calendar initialized', {
                main: config.google.calendarId,
                events: config.google.eventsCalendarId || 'not configured',
                birthdays: config.google.birthdaysCalendarId || 'not configured'
            });
        } catch (err) {
            logger.error('Failed to initialize Calendar', { error: err.message });
        }

        return this;
    }

    /**
     * Check if calendar is available
     */
    isAvailable() {
        return !!this.calendar;
    }

    /**
     * Resolve calendar name to a list of [{ id, label }]
     * @param {'main'|'events'|'birthdays'|'all'} calendarName
     */
    _resolveCalendars(calendarName = 'main') {
        if (calendarName === 'all') {
            return Object.entries(CALENDAR_MAP)
                .map(([name, getter]) => ({ id: getter(), label: CALENDAR_LABELS[name], name }))
                .filter(c => c.id);
        }
        const getter = CALENDAR_MAP[calendarName];
        if (!getter) return [{ id: config.google.calendarId, label: CALENDAR_LABELS.main, name: 'main' }];
        const id = getter();
        if (!id) return [];
        return [{ id, label: CALENDAR_LABELS[calendarName], name: calendarName }];
    }

    /**
     * Fetch events from a single calendar ID
     */
    async _fetchEvents(calendarId, timeMin, timeMax, maxResults = 50) {
        const response = await this.calendar.events.list({
            calendarId,
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults
        });
        return response.data.items || [];
    }

    /**
     * List events in a date range, optionally from a specific calendar
     * @param {string} startDate - YYYY-MM-DD
     * @param {string} endDate - YYYY-MM-DD (optional)
     * @param {'main'|'events'|'birthdays'|'all'} calendar - which calendar(s) to query
     */
    async listEvents(startDate, endDate = null, calendar = 'main') {
        if (!this.isAvailable()) return { error: 'Calendar not available' };

        try {
            const timeMin = new Date(startDate);
            timeMin.setHours(0, 0, 0, 0);
            const timeMax = endDate ? new Date(endDate) : new Date(startDate);
            timeMax.setHours(23, 59, 59, 999);

            const targets = this._resolveCalendars(calendar);
            if (targets.length === 0) {
                return { error: `Calendar "${calendar}" is not configured. Please set the appropriate CALENDAR_*_ID in .env.` };
            }

            logger.info('Fetching calendar events', { startDate, endDate, calendar, targets: targets.map(t => t.name) });

            // Fetch from all targeted calendars in parallel
            const results = await Promise.all(
                targets.map(async (target) => {
                    try {
                        const items = await this._fetchEvents(target.id, timeMin, timeMax);
                        return items.map(event => ({
                            id: event.id,
                            title: event.summary || 'ללא כותרת',
                            description: event.description || '',
                            start: event.start.dateTime || event.start.date,
                            end: event.end.dateTime || event.end.date,
                            location: event.location || '',
                            isAllDay: !event.start.dateTime,
                            calendar: target.label,
                            calendarName: target.name
                        }));
                    } catch (err) {
                        logger.error(`Failed to fetch from calendar ${target.name}`, { error: err.message });
                        return [];
                    }
                })
            );

            // Merge and sort by start time
            const events = results.flat().sort((a, b) => new Date(a.start) - new Date(b.start));

            return { success: true, count: events.length, events };
        } catch (err) {
            logger.error('Failed to list calendar events', { error: err.message });
            return { error: err.message };
        }
    }

    /**
     * Add a new event to a specific calendar
     * @param {string} title
     * @param {string} date - YYYY-MM-DD
     * @param {string} time - HH:MM (optional)
     * @param {number} durationMinutes
     * @param {string} description
     * @param {'main'|'events'|'birthdays'} calendar - target calendar (default: main)
     */
    async addEvent(title, date, time = null, durationMinutes = 60, description = '', calendar = 'main') {
        if (!this.isAvailable()) {
            db.addToCache('pending_event', { title, date, time, durationMinutes, description, calendar });
            return { error: 'Calendar not available', cached: true, message: 'הוספתי לזיכרון המקומי. אעדכן כשהחיבור יחזור.' };
        }

        const targets = this._resolveCalendars(calendar);
        if (targets.length === 0) {
            return { error: `Calendar "${calendar}" is not configured.` };
        }
        const calendarId = targets[0].id;

        try {
            let event;
            if (time) {
                const [year, month, day] = date.split('-');
                const [hours, minutes] = time.split(':');
                const startDateTime = new Date(year, month - 1, day, hours, minutes);
                const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);
                const pad = (n) => n.toString().padStart(2, '0');
                const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
                event = {
                    summary: title, description,
                    start: { dateTime: fmt(startDateTime), timeZone: 'Asia/Jerusalem' },
                    end: { dateTime: fmt(endDateTime), timeZone: 'Asia/Jerusalem' }
                };
            } else {
                event = { summary: title, description, start: { date }, end: { date } };
            }

            logger.info('Creating calendar event', { title, date, time, calendar });

            const response = await this.calendar.events.insert({ calendarId, requestBody: event });

            return {
                success: true,
                event: { id: response.data.id, title: response.data.summary, link: response.data.htmlLink },
                calendar: targets[0].label
            };
        } catch (err) {
            logger.error('Failed to add calendar event', { error: err.message });
            db.addToCache('pending_event', { title, date, time, durationMinutes, description, calendar });
            return { error: err.message, cached: true };
        }
    }

    /**
     * Check upcoming birthdays and yearly events for the next N days
     * Scans both "אירועים חשובים" and "Hebrew birthdays" calendars
     * @param {number} daysAhead - how many days ahead to look (default 7)
     */
    async checkUpcomingBirthdays(daysAhead = 7) {
        if (!this.isAvailable()) return { error: 'Calendar not available', events: [] };

        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const future = new Date(today);
            future.setDate(future.getDate() + daysAhead);
            future.setHours(23, 59, 59, 999);

            const todayStr = today.toISOString().split('T')[0];
            const futureStr = future.toISOString().split('T')[0];

            // Query events and birthdays calendars (not main)
            const result = await this.listEvents(todayStr, futureStr, 'all');

            if (result.error) return { error: result.error, events: [] };

            // Filter: only events from birthdays/events calendars OR that look like birthdays/anniversaries
            const birthdayKeywords = ['יום הולדת', 'יומולדת', 'birthday', 'ywm hldt', 'יום נישואין', 'נישואין', 'anniversary', 'ذكرى'];
            const specialEvents = result.events.filter(e => {
                const isSpecialCalendar = e.calendarName === 'events' || e.calendarName === 'birthdays';
                const hasBirthdayKeyword = birthdayKeywords.some(kw => e.title.toLowerCase().includes(kw.toLowerCase()));
                return isSpecialCalendar || hasBirthdayKeyword;
            });

            // Tag today vs upcoming
            const todayISO = today.toISOString().split('T')[0];
            const tagged = specialEvents.map(e => {
                const eventDate = e.start.substring(0, 10);
                const isToday = eventDate === todayISO;
                const daysUntil = Math.ceil((new Date(eventDate) - today) / (1000 * 60 * 60 * 24));
                return { ...e, isToday, daysUntil };
            });

            logger.info('Birthday/event check', { found: tagged.length, daysAhead });
            return { success: true, count: tagged.length, events: tagged, daysAhead };
        } catch (err) {
            logger.error('Birthday check failed', { error: err.message });
            return { error: err.message, events: [] };
        }
    }

    /**
     * Legacy: check birthdays today only (used by old scheduler)
     */
    async checkBirthdays() {
        const result = await this.checkUpcomingBirthdays(0);
        return result.events || [];
    }

    /**
     * Delete an event
     * @param {string} eventId - Event ID to delete
     * @param {'main'|'events'|'birthdays'} calendar
     */
    async deleteEvent(eventId, calendar = 'main') {
        if (!this.isAvailable()) return { error: 'Calendar not available' };

        const targets = this._resolveCalendars(calendar);
        const calendarId = targets.length > 0 ? targets[0].id : config.google.calendarId;

        try {
            await this.calendar.events.delete({ calendarId, eventId });
            logger.info('Calendar event deleted', { eventId, calendar });
            return { success: true };
        } catch (err) {
            logger.error('Failed to delete event', { error: err.message });
            return { error: err.message };
        }
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            available: this.isAvailable(),
            calendars: {
                main: config.google.calendarId,
                events: config.google.eventsCalendarId || 'not configured',
                birthdays: config.google.birthdaysCalendarId || 'not configured'
            }
        };
    }
}

export default new CalendarManager();
export { CalendarManager };
