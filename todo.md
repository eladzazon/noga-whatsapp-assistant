# Noga Assistant - TODO List

## 🚀 High Priority
- [ ] **Default Installation Templates**: Create a `templates/` or `data_defaults/` directory with example `.md` files for:
    - `IDENTITY.md` (Who is Noga?)
    - `USER.md` (Personal details template)
    - `SHOPPING_LIST.md` (Knowledge base example)
    - `morning_routine.md` (Skill/Procedure example)
    - `TOOL_RULES.md` (Base operating rules)
- [ ] **Backup & Restore**: Implement a feature to export/import all knowledge and skill files as a single archive (ZIP/JSON) via the Dashboard.

## 🎨 UI/UX Improvements
- [ ] **Button Styling Audit**: Standardize all functional buttons in the Knowledge and Skills tabs:
    - `add-knowledge-file`
    - `save-knowledge`
    - `delete-knowledge-file`
    - Match sizes (e.g., 32px height) and consistent visual language (icons + text).
- [ ] **Confirmation Dialogs**: Add sleek modals for destructive actions like deleting a skill or knowledge file.

## 🛠️ Technical Debt
- [ ] **Token Usage accuracy**: Ensure cumulative usage across tool calls is correctly logged to the DB.
- [ ] **Error Boundaries**: Better UI feedback when a file fails to save or load remotely.
