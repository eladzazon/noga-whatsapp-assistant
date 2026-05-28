# Noga WhatsApp AI Home Assistant — Complete Code Review

> **Scope**: Full codebase review covering 20+ files, ~8,000 lines of code  
> **Date**: 2026-05-28  
> **Reviewed**: Security, Code Quality, Performance, Architecture

---

## Executive Summary

Noga is a well-structured WhatsApp AI home assistant with impressive feature coverage: AI conversations via Gemini, Home Assistant integration, Google Calendar, scheduled tasks, knowledge base, and a full web dashboard with PWA support. The codebase is generally clean and functional.

However, the review uncovered **several critical security vulnerabilities** that should be addressed urgently, along with significant opportunities for code quality, performance, and architectural improvements.

| Severity | Count | Key Areas |
|----------|-------|-----------|
| 🔴 Critical | 7 | Path traversal, SSRF, XSS, auth bypass, secret exposure |
| 🟡 High | 10 | Missing validation, reconnect bugs, monolithic files |
| 🟠 Medium | 15+ | Performance, error handling, dead code |
| 🟢 Low | 10+ | Naming, logging, documentation |

---

## 🔴 Critical Issues — Fix Immediately

### 1. Path Traversal in MemoryManager
**File**: [MemoryManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/MemoryManager.js)

Filenames received from the AI (originating from user input) are joined directly to the knowledge/skills directory with **zero sanitization**:
```js
const filePath = path.join(this.knowledgeDir, filename);
```
An input like `../../.env` or `../../credentials/service-account.json` would read/write/delete files outside the intended directory. Affects `readKnowledgeFile()`, `writeKnowledgeFile()`, `createSkill()`, and `deleteKnowledgeFile()`.

> [!CAUTION]
> This allows arbitrary file read/write/delete on the server via crafted AI function call arguments.

**Fix**:
```js
const resolved = path.resolve(this.knowledgeDir, filename);
if (!resolved.startsWith(path.resolve(this.knowledgeDir))) {
  throw new Error('Invalid filename');
}
```

---

### 2. Path Traversal in Dashboard API
**File**: [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js)

The knowledge and skills file API endpoints use `req.params.filename` directly in `path.join()` without sanitization:
- `PUT /api/knowledge/:filename`
- `DELETE /api/knowledge/:filename`
- `PUT /api/skills/:filename`
- `DELETE /api/skills/:filename`

> [!CAUTION]
> An authenticated dashboard user can read/write/delete arbitrary server files.

**Fix**: Apply `path.basename()` to all filename parameters, similar to the backup download endpoint which already does this.

---

### 3. Socket.IO Authentication Bypass
**File**: [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js)

The Socket.IO middleware has a comment saying "In production, you'd verify the session here" but does **nothing** — it just calls `next()`. Any unauthenticated WebSocket client can:
- Receive real-time logs (may contain sensitive data)
- Use the dashboard chat to send messages through the bot
- Clear chat history
- Trigger system actions

**Fix**: Verify the session in the Socket.IO middleware:
```js
io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.authenticated) {
    next();
  } else {
    next(new Error('Authentication required'));
  }
});
```

---

### 4. SSRF Vulnerability in WebFetcher
**File**: [WebFetcher.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/WebFetcher.js)

`fetchUrl()` accepts any URL with no validation. The AI could be tricked into fetching:
- `http://169.254.169.254/` — cloud metadata (AWS/GCP credentials)
- `http://localhost:8123/api/states` — Home Assistant internal API
- `file://` or `ftp://` scheme URLs
- Internal network resources

> [!WARNING]
> Combined with the fact that URLs can originate from user messages via AI function calls, this is a significant attack vector.

**Fix**: Validate URL scheme (only `http`/`https`), resolve the hostname, and block private/reserved IP ranges (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16).

---

### 5. Secret Exposure in Backups & Settings API
**Files**: [SchedulerManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/SchedulerManager.js), [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js)

Two separate issues:
1. **Backup files** include ALL `.env` variables (API keys, OAuth secrets, passwords) as plain JSON saved to `data/backups/`
2. **`GET /api/settings`** returns all settings including API keys and tokens in plaintext JSON

**Fix**:
- Exclude sensitive keys from backup data or encrypt the backup
- Mask sensitive values in the settings API (e.g., `sk-...****1234`)

---

### 6. XSS via Inline Event Handlers in Dashboard
**File**: [dashboard.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/public/js/dashboard.js)

The `escapeAttr()` function used for inline `onclick` handlers is insufficient — it escapes `\`, `'`, `\n`, `"` but NOT `<`, `>`, or `)`. A keyword containing `');alert('xss` would break out of the attribute:
```js
onclick="window._editKeyword(${kw.id}, '${escapeAttr(kw.keyword)}', ...)"
```

**Fix**: Replace inline event handlers with event delegation. Alternatively, use `encodeURIComponent()` or a proper attribute encoding function.

---

### 7. Safety Filters Completely Disabled
**File**: [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js)

All Gemini safety settings are set to `BLOCK_NONE`:
```js
{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE }
```
This means the bot will generate harmful, explicit, or dangerous content if prompted.

> [!WARNING]
> Combined with the empty whitelist issue (#8 below), this means anyone messaging the bot can generate harmful content.

---

## 🟡 High Priority Issues

### 8. Empty Whitelist = No Access Control
**File**: [MessageRouter.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/MessageRouter.js)

If `WHATSAPP_WHITELIST` is empty or unset, ALL messages are processed:
```js
if (!config.whatsapp.allowedNumbers.length) return true; // processes everything
```
A misconfiguration means the bot responds to **everyone**.

---

### 9. Duplicate Event Listeners on Reconnect
**File**: [WhatsAppManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/WhatsAppManager.js)

When `init()` is called on reconnect, `_setupEventHandlers()` adds new event listeners WITHOUT removing old ones. After multiple reconnects, the `messages.upsert` handler fires **multiple times per message**, causing duplicate processing.

**Fix**: Call `removeAllListeners()` before `_setupEventHandlers()` in reconnect logic.

---

### 10. SQL Injection in MemoryManager
**File**: [MemoryManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/MemoryManager.js)

Search queries use string interpolation in SQL:
```js
WHERE content LIKE '%${query}%'
```

> [!IMPORTANT]
> Use parameterized queries: `WHERE content LIKE '%' || ? || '%'`

---

### 11. All-Day Calendar Event Bug
**File**: [CalendarManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/CalendarManager.js#L164)

For all-day events, `start.date` and `end.date` are set to the same value. Google Calendar API uses **exclusive** end dates — this creates a 0-day (invisible) event.

**Fix**: Set `end.date` to the next day.

---

### 12. Hardcoded Timezone Offset
**File**: [CalendarManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/CalendarManager.js#L68)

`+03:00` is hardcoded for Israel, but Israel observes DST (UTC+2 in winter). This causes off-by-one-hour boundary errors during Nov-Mar.

**Fix**: Use `Intl.DateTimeFormat` or a timezone library like `luxon`.

---

### 13. Processing Queue Silently Drops Messages
**File**: [MessageRouter.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/MessageRouter.js#L44)

If a user sends a second message while the first is being processed, it's **silently dropped** with no feedback. This is especially problematic in group chats.

**Fix**: Queue messages instead of dropping them, or notify the user that their message is pending.

---

### 14. No Login Rate Limiting or CSRF
**File**: [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js)

- No brute-force protection on the `/login` endpoint
- No CSRF tokens on any POST/PUT/DELETE routes
- Password comparison uses `===` instead of `crypto.timingSafeEqual()`

---

### 15. Cached Calendar Events Never Retrieved
**File**: [CalendarManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/CalendarManager.js)

Events cached to DB via `db.addToCache('pending_event', ...)` are **never retrieved or retried**. `getPendingCache('pending_event')` is never called anywhere. The user sees "I'll update when connection returns" but it never happens — dead code giving false confidence.

---

### 16. Unrestricted WhatsApp Messaging via AI
**File**: [skills/index.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/index.js)

The `send_whatsapp_message` function allows the AI to send messages to **any** phone number with no allowlist or rate limiting. A prompt injection could cause the bot to spam arbitrary numbers.

---

### 17. Monolithic Files Need Splitting

| File | Lines | Recommendation |
|------|-------|----------------|
| [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js) | ~1,354 | Split into route modules + middleware |
| [dashboard.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/public/js/dashboard.js) | ~1,696 | Split into tab-specific modules |
| [dashboard.ejs](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/views/dashboard.ejs) | ~880 | Split into EJS partials |
| [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js) | ~693 | Split into prompt builder, API client, tool handler |
| [skills/index.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/index.js) | ~534 | Extract built-in skills into separate handler files |

---

## 🟠 Medium Priority Issues

### Performance

| Issue | File | Details |
|-------|------|---------|
| All HA entities fetched on every search | [HomeAssistantManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/HomeAssistantManager.js#L93) | `/api/states` returns ALL entities (1000+). Add TTL cache |
| System prompt rebuilt every message | [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js) | Reads all knowledge files from disk. Add short TTL cache |
| Dashboard loads everything on page load | [dashboard.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/public/js/dashboard.js#L1682) | 10+ API calls on load regardless of active tab. Lazy-load per tab |
| No response compression | [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js) | Add `compression` middleware |
| Log file read entirely into memory | [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js#L202) | Use streaming/tail for log reading |
| Synchronous file I/O everywhere | Multiple files | `readFileSync`, `writeFileSync` block event loop |
| Missing DB indexes | [schema.sql](file:///c:/Projects/noga-whatsapp-assistant/src/database/schema.sql) | Need composite indexes on `chat_context(user_id, created_at)`, `reminders(status)`, `memories(category)` |
| `getKeywordByText` loads all keywords | [DatabaseManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/database/DatabaseManager.js) | Scans ALL keywords per message. Use SQL filtering |

### Error Handling

| Issue | File |
|-------|------|
| `response.text()` called before try/catch in GeminiManager | [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js#L267) |
| `lastError` variable set but never used (returns `undefined`) | [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js) |
| `unhandledRejection` doesn't exit process | [index.js](file:///c:/Projects/noga-whatsapp-assistant/src/index.js#L187) |
| Empty catch blocks in DB migrations swallow real errors | [DatabaseManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/database/DatabaseManager.js) |
| `validateConfig()` returns errors but doesn't throw | [config.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/config.js) |
| Internal error details leak to users via WhatsApp | [MessageRouter.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/MessageRouter.js#L93) |

### Dead Code & Inconsistencies

| Issue | File |
|-------|------|
| `KnowledgeManager.buildSystemPrompt()` is never called | [KnowledgeManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/KnowledgeManager.js) |
| Birthday check finds birthdays but never sends messages | [index.js](file:///c:/Projects/noga-whatsapp-assistant/src/index.js#L114) |
| `CONTEXT_TIMEOUT_MS` defined but never used | [MessageRouter.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/MessageRouter.js#L13) |
| History comment says "last 40 messages" but code fetches 5 | [MessageRouter.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/MessageRouter.js) vs [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js) |
| `.wwebjs_auth` and `.wwebjs_cache` in gitignore (app uses Baileys) | [.gitignore](file:///c:/Projects/noga-whatsapp-assistant/.gitignore) |
| `HaRecognition.js` duplicates Gemini's device recognition | [HaRecognition.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/HaRecognition.js) |
| Stale "Chromium/Alpine" comments in Dockerfile | [Dockerfile](file:///c:/Projects/noga-whatsapp-assistant/Dockerfile) |
| `db` singleton vs `this.db` used inconsistently in server.js | [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js) |
| Duplicate reminder form IDs in dashboard.ejs break the modal | [dashboard.ejs](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/views/dashboard.ejs) |
| Duplicate backup creation logic (DRY violation) | [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js) |
| `closeModal` function called in HTML but never defined | [dashboard.ejs](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/views/dashboard.ejs) |
| CSS variables `--border` and `--light-bg` used but never defined | [dashboard.ejs](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/views/dashboard.ejs) & [dashboard.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/public/js/dashboard.js) |

---

## 🟢 Low Priority / Best Practices

### Infrastructure

| Issue | Recommendation |
|-------|---------------|
| Most dependencies use `"*"` (unpinned) | Pin to specific versions in [package.json](file:///c:/Projects/noga-whatsapp-assistant/package.json). Any `npm install` can pull breaking changes |
| `seccomp:unconfined` in docker-compose | Remove — not needed since Baileys doesn't use Chromium |
| Node 24 is not LTS | Consider Node 22 LTS for stability |
| No tests whatsoever | Add a test framework (Vitest/Jest) and at least unit tests for critical paths |
| No API documentation | Consider Swagger/OpenAPI for dashboard API |
| PWA icons are identical files (both 424KB) | Generate properly sized icons |

### Code Quality

| Issue | Recommendation |
|-------|---------------|
| No config schema validation | Use `zod` or `joi` to validate config at startup |
| No database migration system | Add versioned migrations to prevent schema drift |
| Hebrew strings hardcoded throughout | Extract to a localization file |
| Singleton pattern makes testing impossible | Consider dependency injection |
| Logger uses `console.log` in some places | Standardize on Winston everywhere |
| HTML parsing with regex in WebFetcher | Use `cheerio` for reliable HTML parsing |
| `reinit()` called without `await` in skills | Add `await` to prevent silent failures |
| No multer file size/type limits | Configure limits and file type filtering |
| File editor race condition in dashboard | Warn users of unsaved changes |

---

## Architecture Recommendations

### Short-term (Quick Wins)
1. **Add path traversal guards** to MemoryManager and server.js file APIs
2. **Add Socket.IO authentication middleware**
3. **Pin dependency versions** in package.json
4. **Add missing DB indexes** for frequently queried columns
5. **Fix the all-day calendar event bug**
6. **Add URL validation to WebFetcher** (block private IPs)

### Medium-term (Next Sprint)
1. **Split server.js** into route modules: `auth.routes.js`, `knowledge.routes.js`, `settings.routes.js`, etc.
2. **Add rate limiting** via `express-rate-limit` on login and API endpoints
3. **Add CSRF protection** via `csurf` or double-submit cookie pattern
4. **Add entity caching to HomeAssistantManager** with 60-second TTL
5. **Replace inline event handlers** in dashboard with event delegation
6. **Add a message queue** instead of silently dropping concurrent messages
7. **Fix reconnect listener duplication** in WhatsAppManager
8. **Mask sensitive values** in settings API and backups

### Long-term (Architecture)
1. **Dependency injection** — Replace singleton imports with a proper DI container
2. **Split GeminiManager** into prompt builder, API client, and tool handler
3. **Add a test suite** — At least unit tests for security-critical paths
4. **Structured JSON logging** with correlation IDs
5. **Database migration system** — Versioned migrations instead of inline schema changes
6. **Extract dashboard JS into modules** — Use ES modules or a bundler
7. **i18n support** — Extract Hebrew strings into a localization file

---

## File-by-File Summary

| Module | File | Lines | Grade | Key Issue |
|--------|------|-------|-------|-----------|
| Entry | [index.js](file:///c:/Projects/noga-whatsapp-assistant/src/index.js) | 193 | B | Dead birthday code, no health checks |
| Bot | [GeminiManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/GeminiManager.js) | 693 | C+ | Safety filters off, no token counting, too large |
| Bot | [WhatsAppManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/WhatsAppManager.js) | 517 | C+ | Listener duplication on reconnect, media bug |
| Bot | [MessageRouter.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/MessageRouter.js) | 324 | C | Silent message dropping, empty whitelist bypass |
| Bot | [KnowledgeManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/KnowledgeManager.js) | 316 | B- | Dead code, sync I/O, no file locking |
| Bot | [SchedulerManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/bot/SchedulerManager.js) | 282 | C+ | Secrets in backups, no stop/destroy |
| Skills | [index.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/index.js) | 534 | C | Unrestricted messaging, giant switch, no validation |
| Skills | [CalendarManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/CalendarManager.js) | 266 | C+ | All-day bug, hardcoded timezone, dead cache |
| Skills | [HomeAssistantManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/HomeAssistantManager.js) | 230 | B- | No entity caching, dead MCP client |
| Skills | [MemoryManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/skills/MemoryManager.js) | 128 | D | Path traversal, SQL injection, sync I/O |
| Database | [DatabaseManager.js](file:///c:/Projects/noga-whatsapp-assistant/src/database/DatabaseManager.js) | 697 | B- | No migrations, empty catches, god class |
| Database | [schema.sql](file:///c:/Projects/noga-whatsapp-assistant/src/database/schema.sql) | 111 | C+ | Missing indexes, no cascading deletes |
| Utils | [config.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/config.js) | 210 | B | Defaults allow insecure startup, no schema validation |
| Utils | [logger.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/logger.js) | 134 | B | Monkey-patched log(), relative paths |
| Utils | [WebFetcher.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/WebFetcher.js) | 240 | D+ | SSRF, regex HTML parsing, no URL validation |
| Utils | [HaRecognition.js](file:///c:/Projects/noga-whatsapp-assistant/src/utils/HaRecognition.js) | 49 | C | Toggle bug, redundant with Gemini, substring matching |
| Dashboard | [server.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/server.js) | 1,354 | D+ | Path traversal, auth bypass, no CSRF, god class |
| Dashboard | [dashboard.ejs](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/views/dashboard.ejs) | 880 | C | Duplicate IDs, undefined functions, inline JS |
| Dashboard | [dashboard.js](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/public/js/dashboard.js) | 1,696 | C | XSS via escapeAttr, global scope, no error handling |
| Dashboard | [style.css](file:///c:/Projects/noga-whatsapp-assistant/src/dashboard/public/css/style.css) | 976 | B- | Missing CSS vars, single breakpoint, no dark mode toggle |

---

> **Overall Grade: C+** — The application is functional and feature-rich, but has significant security vulnerabilities that need immediate attention. The codebase would benefit greatly from splitting monolithic files, adding input validation, and implementing proper authentication throughout.
