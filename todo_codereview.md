# Noga — Code Review TODO (Quality · Performance · Architecture)

> Generated: 2026-05-28 | Security items excluded — internal-use only project

---

## 🐛 Bugs to Fix

- [x] **All-day calendar events are invisible** — `start.date` and `end.date` are the same; Google Calendar uses exclusive end dates, so this creates a 0-day event.
  - File: `src/skills/CalendarManager.js` ~L164
  - Fix: Set `end.date` to the next day

- [x] **Hardcoded timezone `+03:00`** — Israel observes DST (UTC+2 in winter). Causes off-by-one-hour errors Nov–Mar.
  - File: `src/skills/CalendarManager.js` ~L68
  - Fix: Use `Intl.DateTimeFormat` or `luxon`

- [x] **Duplicate event listeners on WhatsApp reconnect** — `_setupEventHandlers()` adds listeners without removing old ones. After multiple reconnects, messages are processed multiple times.
  - File: `src/bot/WhatsAppManager.js` ~L104
  - Fix: Call `removeAllListeners()` before re-registering

- [x] **`body` can be `undefined` causing TypeError** — Image messages without captions pass `undefined` to `body.startsWith('/')`.
  - File: `src/bot/MessageRouter.js` ~L56
  - Fix: Guard with `body && body.startsWith('/')` before accessing

- [x] **`response.text()` called outside try/catch** — Can throw if response has no text candidates, bypassing retry logic.
  - File: `src/bot/GeminiManager.js` ~L267
  - Fix: Move inside the try/catch block

- [x] **`lastError` set but never used** — After the retry loop, the function returns `undefined` instead of throwing or returning the last error.
  - File: `src/bot/GeminiManager.js` ~L229, 368, 423, 508
  - Fix: Return or throw `lastError` after the loop

- [ ] **Cached calendar events are never retrieved** — `db.addToCache('pending_event', ...)` is called but `getPendingCache('pending_event')` is never called anywhere. User sees "I'll update when connection returns" but it never happens.
  - File: `src/skills/CalendarManager.js`
  - Fix: Implement retry logic or remove the dead cache code

- [x] **`pttMessage` media download bug** — Code accesses `messageContent.audioMessage.mimetype` but the correct key is `messageContent.pttMessage.mimetype`.
  - File: `src/bot/WhatsAppManager.js` ~L356
  - Fix: Use the correct key for PTT messages

- [x] **Duplicate element IDs in dashboard** — `reminder-title`, `reminder-dueDate`, `reminder-interval` exist in both the inline form and the modal, causing `getElementById` to return the wrong element.
  - File: `src/dashboard/views/dashboard.ejs` ~L412 vs L848
  - Fix: Use unique IDs for the modal form elements

- [x] **`closeModal` function called but never defined** — `onclick="closeModal('modal-reminder')"` references a nonexistent function.
  - File: `src/dashboard/views/dashboard.ejs` ~L852
  - Fix: Implement the function or remove the onclick

- [x] **CSS variables `--border` and `--light-bg` used but never defined** — Referenced in dashboard.ejs and dashboard.js but missing from style.css `:root`.
  - File: `src/dashboard/public/css/style.css`
  - Fix: Add the variable definitions to `:root`

- [ ] **HaRecognition defaults to `toggle` for queries** — Asking "what's the status of the light?" will toggle it instead of just querying state.
  - File: `src/utils/HaRecognition.js` ~L25
  - Fix: Default to `'state'` or `null` instead of `'toggle'`

- [x] **`reinit()` called without `await`** — Fire-and-forget async calls that could silently fail. (False positive: function is actually synchronous)
  - File: `src/skills/index.js` ~L342, 351, 366
  - Fix: Add `await`

- [ ] **Backup retention of 0 is impossible** — `parseInt('0') || 7` evaluates to `7` because `0` is falsy.
  - File: `src/bot/SchedulerManager.js` ~L171
  - Fix: Use `?? 7` instead of `|| 7`

---

## ⚡ Performance Improvements

- [ ] **Cache Home Assistant entities** — `getEntities()` fetches ALL entities from `/api/states` on every search (can be 1000+). Add a 60-second TTL cache.
  - File: `src/skills/HomeAssistantManager.js` ~L93

- [ ] **Cache/memoize system prompt** — `_buildDynamicSystemPrompt()` reads all knowledge files from disk on every message. Add a short TTL cache (30s).
  - File: `src/bot/GeminiManager.js`

- [ ] **Lazy-load dashboard tab data** — Currently makes 10+ API calls on every page load regardless of which tab is active. Load data only when a tab is activated.
  - File: `src/dashboard/public/js/dashboard.js` ~L1682

- [ ] **Add response compression** — No gzip/brotli compression on the Express server.
  - File: `src/dashboard/server.js`
  - Fix: `app.use(compression())`

- [ ] **Add missing database indexes** — Frequently queried columns have no indexes:
  - `chat_context(user_id, created_at)` — composite index
  - `reminders(status)` — for `getPendingReminders()`
  - `memories(category, user_id)`
  - File: `src/database/schema.sql`

- [ ] **`getKeywordByText` loads ALL keywords per message** — Iterates in JS instead of filtering in SQL.
  - File: `src/database/DatabaseManager.js`
  - Fix: Filter with SQL `WHERE` clause

- [ ] **Log file read entirely into memory** — Reads full combined.log then slices. Use streaming or reverse-line reading.
  - File: `src/dashboard/server.js` ~L202

- [ ] **Switch synchronous file I/O to async** — `readFileSync`, `writeFileSync`, `readdirSync` used throughout block the event loop.
  - Files: `MemoryManager.js`, `KnowledgeManager.js`, `CalendarManager.js`, `server.js`, `logger.js`

- [ ] **Dynamic imports in request handlers** — `await import('../bot/WhatsAppManager.js')` called on every request. Move to top-level imports.
  - File: `src/dashboard/server.js` ~L224, 236, 303, etc.

- [ ] **Debounce file watcher** — `fs.watch` fires multiple times per save, each emitting a Socket.IO event.
  - File: `src/dashboard/server.js` ~L1261

- [ ] **Debounce HA entity filter input** — Fires on every keystroke with no debounce; lags with many entities.
  - File: `src/dashboard/public/js/dashboard.js` ~L621

- [ ] **Returns ALL entities as suggestions** — When no match found, suggestion list includes every entity (1000+), wasting AI tokens.
  - File: `src/skills/HomeAssistantManager.js` ~L206
  - Fix: Limit to top 10-20 suggestions

- [ ] **`maxResults: 20` hardcoded for calendar** — Busy calendars silently truncate with no user indication.
  - File: `src/skills/CalendarManager.js` ~L86
  - Fix: Make configurable or increase default

---

## 🏗️ Architecture & Code Quality

### Monolithic Files to Split

- [ ] **`server.js` (1,354 lines)** → Split into route modules:
  - `routes/auth.js` — login/logout/session
  - `routes/knowledge.js` — knowledge & skills CRUD
  - `routes/settings.js` — config management
  - `routes/backup.js` — backup/restore
  - `routes/api.js` — conversations, contacts, reminders
  - `middleware/auth.js` — authentication middleware
  - `middleware/error.js` — centralized error handler
  - `socket/handlers.js` — Socket.IO event handlers

- [ ] **`dashboard.js` (1,696 lines)** → Split into tab modules:
  - `js/tabs/chat.js`
  - `js/tabs/knowledge.js`
  - `js/tabs/settings.js`
  - `js/tabs/reminders.js`
  - etc.

- [ ] **`dashboard.ejs` (880 lines)** → Split into EJS partials:
  - `views/partials/sidebar.ejs`
  - `views/partials/tab-chat.ejs`
  - `views/partials/tab-knowledge.ejs`
  - etc.

- [ ] **`GeminiManager.js` (693 lines)** → Split into:
  - `PromptBuilder.js` — system prompt construction
  - `GeminiApiClient.js` — API communication & retry logic
  - `ToolCallHandler.js` — function call processing

- [ ] **`skills/index.js` (534 lines)** → Extract each built-in skill into its own file:
  - `skills/handlers/reminder.js`
  - `skills/handlers/list.js`
  - `skills/handlers/shopping.js`
  - `skills/handlers/search.js`
  - etc.

### Error Handling

- [ ] **Standardize error handling pattern** — Currently mixed: some throw, some return `null`, some return `{ error: ... }`, some return strings.
  - Recommendation: Adopt a consistent `Result` pattern or always throw with custom error classes

- [ ] **Add centralized error middleware for Express** — Replace 30+ identical try/catch blocks.

- [ ] **`unhandledRejection` should exit the process** — Currently logs but keeps running in a broken state.
  - File: `src/index.js` ~L187

- [ ] **Empty catch blocks in DB migrations** — `catch { /* table may not exist */ }` swallows ALL errors including disk full, corruption.
  - File: `src/database/DatabaseManager.js` ~L42, 96
  - Fix: Check for specific SQLite error codes

- [ ] **`validateConfig()` returns errors but doesn't throw** — Callers can silently ignore missing required config.
  - File: `src/utils/config.js`
  - Fix: Throw on critical missing config, or log and exit

- [ ] **Internal error details leak to WhatsApp users** — `err.message` sent directly to users could expose internal paths.
  - File: `src/bot/MessageRouter.js` ~L93
  - Fix: Send generic error message, log full error internally

### Dead Code & Cleanup

- [ ] **Remove `KnowledgeManager.buildSystemPrompt()`** — Never called; `GeminiManager._buildDynamicSystemPrompt()` is used instead.
  - File: `src/bot/KnowledgeManager.js`

- [ ] **Remove or implement birthday feature** — Birthdays are found and logged but never sent.
  - File: `src/index.js` ~L114-133

- [ ] **Remove `CONTEXT_TIMEOUT_MS`** — Defined but never used.
  - File: `src/bot/MessageRouter.js` ~L13

- [ ] **Fix history window discrepancy** — Comment says "last 40 messages" but code fetches 5.
  - File: `src/bot/MessageRouter.js` vs `src/bot/GeminiManager.js`

- [ ] **Remove stale `.wwebjs_auth/.wwebjs_cache` from .gitignore** — App uses Baileys, not whatsapp-web.js. Also delete the `.wwebjs_cache` directory from the repo root.
  - File: `.gitignore`

- [ ] **Remove `HaRecognition.js` or make it configurable** — Duplicates Gemini's `find_device` tool. If kept, load mappings from DB instead of hardcoding.
  - File: `src/utils/HaRecognition.js`

- [ ] **Remove stale Chromium/Alpine comments** — Dockerfile references Chromium but app uses Baileys.
  - File: `Dockerfile`

- [ ] **Remove duplicate backup creation logic** — Exists in both `GET /api/backup` and `POST /api/backups/create`.
  - File: `src/dashboard/server.js`

- [ ] **Fix `console.log` mixed with `logger`** — Some messages use `console.log` while the rest uses Winston.
  - File: `src/database/DatabaseManager.js` ~L40, 94, 98

### Infrastructure & Config

- [ ] **Pin dependency versions** — Most use `"*"` (latest). Any `npm install` can pull breaking changes.
  - File: `package.json`
  - Fix: Run `npm ls` and pin current working versions

- [ ] **Add config schema validation** — Use `zod` or `joi` to validate all config at startup and fail fast.
  - File: `src/utils/config.js`

- [ ] **Add database migration system** — Currently uses inline `ALTER TABLE` with empty catches. Schema changes are fragile.
  - File: `src/database/DatabaseManager.js`
  - Recommendation: Use a simple versioned migration approach

- [ ] **Fix duplicate schema definitions** — Tables like `ha_mappings`, `scheduled_prompts`, `reminders` are defined in both `schema.sql` AND `DatabaseManager.init()`.
  - Files: `src/database/schema.sql`, `src/database/DatabaseManager.js`

- [ ] **Remove `seccomp:unconfined`** from docker-compose — Not needed since Baileys doesn't use Chromium.
  - File: `docker-compose.yml`

- [ ] **Fix PWA icons** — `icon-192x192.png` and `icon-512x512.png` are both 424KB (identical files). Generate properly sized icons.
  - File: `src/dashboard/public/images/`

- [ ] **Add `lang` and `dir` to PWA manifest** — Hebrew RTL app should specify `"lang": "he"` and `"dir": "rtl"`.
  - File: `src/dashboard/public/manifest.json`

### Message Handling

- [ ] **Queue messages instead of dropping them** — Currently silently drops messages if one is already processing for a context.
  - File: `src/bot/MessageRouter.js` ~L44
  - Fix: Implement a per-context FIFO queue, or at minimum notify the user

- [ ] **Add message processing timeout** — A stuck Gemini call blocks the context indefinitely.
  - File: `src/bot/MessageRouter.js`
  - Fix: Add a timeout (e.g., 60s) with user notification

- [ ] **Add no-reconnect backoff** — Simple counter with `setTimeout` for WhatsApp reconnection. No exponential backoff.
  - File: `src/bot/WhatsAppManager.js`

- [ ] **Long message splitting can break mid-emoji** — 4000-char splitting doesn't respect character boundaries.
  - File: `src/bot/WhatsAppManager.js`
  - Fix: Use a Unicode-aware split function

### Dashboard Quality

- [ ] **Replace inline event handlers with event delegation** — `onclick="window._editKeyword(...)"` pattern is fragile and pollutes global scope.
  - File: `src/dashboard/public/js/dashboard.js`

- [ ] **Add loading states for async operations** — No visual feedback during CRUD operations; users may double-click.
  - File: `src/dashboard/public/js/dashboard.js`

- [ ] **Add unsaved changes warning** — File editor silently overwrites user edits on remote `file_changed` events.
  - File: `src/dashboard/public/js/dashboard.js` ~L409

- [ ] **Extract inline JavaScript from EJS templates** — Hundreds of lines of JS embedded in templates.
  - File: `src/dashboard/views/dashboard.ejs`

- [ ] **Add input validation on `/api/config`** — Accepts arbitrary `key` and `value` with no validation.
  - File: `src/dashboard/server.js` ~L162

- [ ] **Fix `db` vs `this.db` inconsistency** — Server uses both the imported singleton and an instance property. Could cause silent failures.
  - File: `src/dashboard/server.js`

---

## Priority Order

### Phase 1 — Bug Fixes (Quick Wins)
Items that are causing actual incorrect behavior:
1. All-day calendar event bug
2. Timezone hardcoding
3. Duplicate event listeners on reconnect
4. `body` undefined TypeError
5. `response.text()` outside try/catch
6. PTT message media download bug
7. Dashboard duplicate IDs + missing functions/CSS vars
8. `reinit()` without await

### Phase 2 — Performance
Items with immediate user-facing impact:
1. Add missing DB indexes
2. Cache HA entities (60s TTL)
3. Lazy-load dashboard tabs
4. Add response compression
5. Debounce file watcher + filter input

### Phase 3 — Code Quality
Clean up for maintainability:
1. Pin dependency versions
2. Remove dead code
3. Standardize error handling
4. Fix `console.log` vs logger
5. Clean up stale gitignore entries

### Phase 4 — Architecture
Major refactoring:
1. Split server.js into route modules
2. Split dashboard.js into tab modules
3. Split GeminiManager into focused classes
4. Add config validation
5. Add database migration system
6. Message queue instead of drop
