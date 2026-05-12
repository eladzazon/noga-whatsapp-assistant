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
- [x] **Dependency Updates**: Fix deprecated build log warnings:
    - [x] check full build log from github actions and get warning and errors from there. and fix them, explicit:
        - [ ] `node-domexception@1.0.0`: Use native DOMException instead (Blocked by deep upstream dependencies in googleapis/gaxios).
        - [x] `glob@10.5.0`: Update to a newer version to address security vulnerabilities.
        - [x] `protobufjs <7.5.5`: Resolved critical vulnerabilities via global override.

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

- [x] **Boot Notification**: Send a WhatsApp message to `ADMIN_PHONE` when the assistant successfully connects and is ready.



## 🧠 AI & Context Improvements
- [x] **Context Awareness Logic**: Improved context handling — short messages (≤8 words) and volatile requests (device/calendar controls) now maintain history to resolve relative pronouns correctly. Quoted replies are also passed as explicit context.
- [x] **Private-to-Group Delegation**: Admin can send a private message to Noga like "שלחי לקבוצה: ארוחת ערב מוכנה!" and Noga will compose and relay the message to the family group.
- [x] **🎙️ Voice Note Processing**:
    - Transcription via Gemini multimodal (already working).
    - Prompt updated to explicitly request Hebrew transcription + summary for recordings >30 seconds.


## 🖥️ Dashboard Expansion
- [x] **AI Interaction Page**: A dedicated "Chat" tab to interact with Noga directly from the dashboard for testing and debugging.

## 📅 Calendar & Reminders
- [ ] **Nudge Expiration**: Automatically stop nudging or mark as "expired" if a reminder has been nudged more than 10 times without response.
- [ ] **Backup & Restore Extension**: Include the `reminders` table in the automated daily backups and restore logic and the dashboard backup and restore logic.
- [x] **Reminder Nudge Updates**: Added instructions for Noga to tell users they can mark a reminder as done by reacting with a "Like" (👍) emoji.
- [x] **Next Nudge Field**: Add "נדנוד הבא" column to the admin panel reminders table.

## ⚡ Performance & Optimization
- [ ] **Dynamic Model Switching**: Implement logic in the message router to detect request complexity:
    - Use **Gemini 3.1 Pro** for complex reasoning, multi-tool tasks, or nuanced conversations (verify this is the latest Pro version).
    - Use **Gemini 2.5 Flash** for simple responses, direct lookups, or high-speed interactions.

## 🏠 Home Assistant Integrations
- [x] **Camera Snapshot Integration**: Implement a way for Home Assistant to trigger a camera snapshot and send it to Noga, so she can forward the image to the designated WhatsApp group. add documentation in Noga-Home-Assistant-Guide.md for this feature.
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
    - **🚗 Cars Maintenance**:
        - Track service history, oil changes, and annual inspections (Test).
        - Log fuel consumption and mileage.
        - Set reminders for insurance and license renewals.
    - **Reminders**: Set automated alerts for all maintenance tasks.

- [ ] **📰 Knowledge Aggregation**:
    - **Link Saver**: Save and categorize links shared in chat to a `LINKS.md`.
    - **News Summaries**: Integration with news APIs to provide a "Morning Briefing" tailored to user interests.
