# Noga Assistant - TODO List

## 🚀 High Priority
- [x] **Default Installation Templates**: Create a `templates/` or `data_defaults/` directory with example `.md` files for:
    - `IDENTITY.md` (Who is Noga?)
    - `USER.md` (Personal details template)
    - `SHOPPING_LIST.md` (Knowledge base example)
    - `morning_routine.md` (Skill/Procedure example)
    - `TOOL_RULES.md` (Base operating rules)
- [x] **Backup & Restore**: Implement a feature to export/import all knowledge and skill files as a single archive (ZIP/JSON) via the Dashboard.

## 🛠️ Technical Debt
- [ ] **Token Usage accuracy**: Ensure cumulative usage across tool calls is correctly logged to the DB.
- [ ] **Error Boundaries**: Better UI feedback when a file fails to save or load remotely.

## 🧠 AI & Context Improvements
- [ ] **Context Awareness Logic**: Improve how Noga handles incoming messages to distinguish between:
    1. A reply to the previous message (even if not formally quoted).
    2. A completely new topic.
    This ensures Noga maintains conversation continuity when the user sends short/partial follow-ups.

## 🖥️ Dashboard Expansion
- [ ] **AI Interaction Page**: A dedicated "Chat" tab to interact with Noga directly from the dashboard for testing and debugging.
- [ ] **Remote Conversation Manager**: A WhatsApp-Web-like interface to view active conversations, message history, and send/receive messages remotely via the admin panel.

## 📅 Calendar Enhancements
- [ ] **Multi-Calendar Support**: Extend the calendar skill to handle multiple calendars (not just "primary").
- [ ] **Birthday & Event Reminders**: Add logic to scan specific calendars for birthdays and anniversaries.
- [ ] **Reminder Cronjobs**: Implement scheduled jobs to send daily/weekly birthday and event summaries via WhatsApp.

## ⚡ Performance & Optimization
- [ ] **Dynamic Model Switching**: Implement logic in the message router to detect request complexity:
    - Use **Gemini 3.1 Pro** for complex reasoning, multi-tool tasks, or nuanced conversations (verify this is the latest Pro version).
    - Use **Gemini 2.5 Flash** for simple responses, direct lookups, or high-speed interactions.



