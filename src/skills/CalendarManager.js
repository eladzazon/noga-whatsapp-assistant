import { google } from 'googleapis';
import fs from 'fs';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import db from '../database/DatabaseManager.js';

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
            // Check if service account file exists
            try {
                await fs.promises.access(config.google.serviceAccountPath);
            } catch {
                logger.warn('Google Service Account file not found', {
                    path: config.google.serviceAccountPath
                });
                return this;
            }

            // Load service account credentials
            const credentials = JSON.parse(
                await fs.promises.readFile(config.google.serviceAccountPath, 'utf-8')
            );

            // Create auth client
            this.auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/calendar']
            });

            // Create calendar client
            this.calendar = google.calendar({ version: 'v3', auth: this.auth });

            logger.info('Google Calendar initialized');
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
     * List events in a date range from all configured calendars
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD), optional
     */
    async listEvents(startDate, endDate = null) {
        if (!this.isAvailable()) {
            return { error: 'Calendar not available' };
        }

        try {
            // Use Intl to get the correct Israel timezone offset dynamically (+02:00 or +03:00)
            const getOffset = (dateStr) => {
                const date = new Date(dateStr);
                const tzString = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Jerusalem',
                    timeZoneName: 'longOffset'
                }).format(date);
                const match = tzString.match(/[+-]\d{2}:\d{2}/);
                return match ? match[0] : '+02:00';
            };

            const timeMin = `${startDate}T00:00:00${getOffset(startDate)}`;
            const endD = endDate || startDate;
            const timeMax = `${endD}T23:59:59${getOffset(endD)}`;

            // Deduplicated list of all calendar IDs to query
            const calendarIds = [...new Set([config.google.calendarId, ...(config.google.extraCalendarIds || [])])];

            logger.info('Fetching calendar events (Timezone Corrected)', {
                startDate,
                endDate: endDate || startDate,
                timeMin,
                timeMax,
                calendars: calendarIds
            });

            // Fetch from all calendars in parallel
            const responses = await Promise.allSettled(
                calendarIds.map(calId =>
                    this.calendar.events.list({
                        calendarId: calId,
                        timeMin,
                        timeMax,
                        singleEvents: true,
                        orderBy: 'startTime',
                        maxResults: 50
                    }).then(res => ({ calId, items: res.data.items || [] }))
                )
            );

            // Collect results, log failures but don't abort
            const allEvents = [];
            for (const result of responses) {
                if (result.status === 'fulfilled') {
                    const { calId, items } = result.value;
                    for (const event of items) {
                        allEvents.push({ _calendarId: calId, ...event });
                    }
                } else {
                    logger.warn('Failed to fetch from one calendar', { error: result.reason?.message });
                }
            }

            // Sort merged results by start time
            allEvents.sort((a, b) => {
                const aTime = a.start.dateTime || a.start.date;
                const bTime = b.start.dateTime || b.start.date;
                return aTime.localeCompare(bTime);
            });

            return {
                success: true,
                count: allEvents.length,
                events: allEvents.map(event => ({
                    id: event.id,
                    calendarId: event._calendarId,
                    title: event.summary || 'ללא כותרת',
                    description: event.description || '',
                    start: event.start.dateTime || event.start.date,
                    end: event.end.dateTime || event.end.date,
                    location: event.location || '',
                    isAllDay: !event.start.dateTime
                }))
            };
        } catch (err) {
            logger.error('Failed to list calendar events', { error: err.message });
            return { error: err.message };
        }
    }

    /**
     * Add a new event
     * @param {string} title - Event title
     * @param {string} date - Event date (YYYY-MM-DD)
     * @param {string} time - Event time (HH:MM), optional for all-day
     * @param {number} durationMinutes - Duration in minutes, default 60
     * @param {string} description - Event description, optional
     */
    async addEvent(title, date, time = null, durationMinutes = 60, description = '') {
        if (!this.isAvailable()) {
            return {
                error: 'Calendar not available',
                message: 'היומן לא מחובר כרגע. לא ניתן להוסיף פגישה.'
            };
        }

        try {
            let event;

            if (time) {
                // Timed event
                const [year, month, day] = date.split('-');
                const [hours, minutes] = time.split(':');

                // Note month is 0-indexed in Date constructor
                const startDateTime = new Date(year, month - 1, day, hours, minutes);
                const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);

                // Format as YYYY-MM-DDTHH:mm:00 without the 'Z' (UTC specifier)
                // This ensures Google Calendar actually applies the provided timezone
                const pad = (n) => n.toString().padStart(2, '0');
                const formatDateTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

                event = {
                    summary: title,
                    description,
                    start: {
                        dateTime: formatDateTime(startDateTime),
                        timeZone: 'Asia/Jerusalem'
                    },
                    end: {
                        dateTime: formatDateTime(endDateTime),
                        timeZone: 'Asia/Jerusalem'
                    }
                };
            } else {
                // All-day event
                const nextDay = new Date(date);
                nextDay.setDate(nextDay.getDate() + 1);
                const nextDayStr = nextDay.toISOString().split('T')[0];

                event = {
                    summary: title,
                    description,
                    start: { date },
                    end: { date: nextDayStr }
                };
            }

            logger.info('Creating calendar event', { title, date, time });

            const response = await this.calendar.events.insert({
                calendarId: config.google.calendarId,
                requestBody: event
            });

            return {
                success: true,
                event: {
                    id: response.data.id,
                    title: response.data.summary,
                    link: response.data.htmlLink
                }
            };
        } catch (err) {
            logger.error('Failed to add calendar event', { error: err.message });

            return {
                error: err.message
            };
        }
    }

    /**
     * Check for birthday events today
     * @returns {Array} List of birthday events
     */
    async checkBirthdays() {
        if (!this.isAvailable()) {
            return [];
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const result = await this.listEvents(today);

            if (result.error) {
                return [];
            }

            // Filter for birthday events
            const birthdayKeywords = ['birthday', 'יום הולדת', 'יומולדת'];
            const birthdays = result.events.filter(event =>
                birthdayKeywords.some(keyword =>
                    event.title.toLowerCase().includes(keyword)
                )
            );

            logger.info('Birthday check', { found: birthdays.length });

            return birthdays;
        } catch (err) {
            logger.error('Birthday check failed', { error: err.message });
            return [];
        }
    }

    /**
     * Delete an event
     * @param {string} eventId - Event ID to delete
     */
    async deleteEvent(eventId) {
        if (!this.isAvailable()) {
            return { error: 'Calendar not available' };
        }

        try {
            await this.calendar.events.delete({
                calendarId: config.google.calendarId,
                eventId
            });

            logger.info('Calendar event deleted', { eventId });
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
            calendarId: config.google.calendarId,
            extraCalendarIds: config.google.extraCalendarIds || []
        };
    }
}

export default new CalendarManager();
export { CalendarManager };
