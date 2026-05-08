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

## 🛠️ Debugging & Maintenance
- [x] **Remote Admin Commands**: Implemented a suite of commands starting with `/` for remote management via WhatsApp:
    - `/help`: Display all available admin commands and their functions.
    - `/log`: Receive the latest server logs.
    - `/restart` or `/reset`: Trigger a safe restart of the assistant.
    - `/status`: Get detailed system health (WA connection, HA, Gemini quota).
    - `/clear`: Clear current conversation history for the user.
    - `/backup`: Trigger a manual backup and receive the file.
    > ⚠️ Admin-only commands (`/log`, `/backup`, `/restart`) require `ADMIN_PHONE` to be set in `.env`.
- [x] **Automated Backups**: Daily backup at 02:00 AM (Israel time) — saved to `data/backups/` on the server (keeps last 7). Download via the dashboard `/api/backup`.

- [x] **Full System Backup**: Backup & Restore now covers all data — not just `.md` files:
    - AI Keywords & Custom Responses.
    - Home Assistant Entity Mappings & Nicknames.
    - Scheduled Cronjobs & Automations.
    - User Preferences & Settings (DB-backed env overrides).



## 🧠 AI & Context Improvements
- [ ] **Context Awareness Logic**: Improve how Noga handles incoming messages to distinguish between:
    1. A reply to the previous message (even if not formally quoted).
    2. A completely new topic.
    This ensures Noga maintains conversation continuity when the user sends short/partial follow-ups.
- [ ] **Private-to-Group Delegation**: Enable Noga to receive a private message from the user (admin) and understand instructions to perform actions or relay messages to a specific WhatsApp group (e.g., "Ask my wife in the group if we need milk").
- [ ] **🎙️ Voice Note Processing**:
    - Automatically transcribe incoming WhatsApp voice notes using an AI transcription service.
    - Provide a concise summary for long recordings.


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

## 🏠 Home Assistant Integrations
- [ ] **Camera Snapshot Integration**: Implement a way for Home Assistant to trigger a camera snapshot and send it to Noga, so she can forward the image to the designated WhatsApp group.
- [x] **Presence Awareness**: Implement a skill to check who is currently at home by querying Home Assistant `person` entities (e.g., "Noga, who is home right now?").
- [x] **Webhook API Documentation & Validation**:
    - Verify minimum payload for `/api/notify`. (Done: `event` is required, `data` is optional).
    - Update `Noga-Home-Assistant-Guide.md` with safe payload template (`default({})`) to avoid HA serialization errors.





## ✨ New Skills & Knowledge Domains
- [ ] **💰 Financial Tracking**:
    - **Expense Logging**: Log daily expenses (e.g., "Noga, I spent 50 NIS on fuel") to a `FINANCE.md` or a DB.
    - **Kids' Allowance/Savings**:
        - Log money received for each child (e.g., "Noga, Grandma gave 100 NIS to [Child]").
        - Track running balances and savings for each child.
        - Log expenditures when they use their saved money.
    - **Reports**: Generate detailed spending and savings summaries whenever prompted.


- [ ] **🍳 Kitchen Intelligence**:
    - **Recipe Manager**: Store and retrieve recipes.
    - **Meal Planning**: Suggest meals based on current `INVENTORY.md` stock.
    - **Expiration Alerts**: Track and notify about items near their expiration date.
- [ ] **🏥 Family & Health Memory**:
    - **Health Log**: Track symptoms, medications, or doctor visits.
    - **Kids' Sizes**: Store shoe/clothing sizes for the children to reference when shopping.
- [ ] **🔧 Home Maintenance Registry**:
    - **General Home**: Log last time filters were changed or garden was treated.
    - **🚗 Cars Maintenance**:
        - Track service history, oil changes, and annual inspections (Test).
        - Log fuel consumption and mileage.
        - Set reminders for insurance and license renewals.
    - **Reminders**: Set automated alerts for all maintenance tasks.

- [ ] **📰 Knowledge Aggregation**:
    - **Link Saver**: Save and categorize links shared in chat to a `LINKS.md`.
    - **News Summaries**: Integration with news APIs to provide a "Morning Briefing" tailored to user interests.
- [ ] **🎮 Gamification & Persona**:
    - Enhance Noga's personality with varied responses based on "mood" or time of day.
    - Implement a "Karma" or "Efficiency" score for household tasks.


