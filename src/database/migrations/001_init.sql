-- Block 2: Postgres schema, multi-tenant-ready.
-- Applied once by scripts/run_migrations.js when the `instance` table does not yet exist.
-- Single-tenant today (all data scoped to profiles.tenant_id = 'family_core'); every table
-- carries tenant_id from day one so Block 4 (real multi-tenancy) doesn't require another migration.

CREATE TABLE IF NOT EXISTS instance (
    instance_id TEXT PRIMARY KEY DEFAULT 'default',
    current_version TEXT,
    schema_version INTEGER NOT NULL,
    last_update_check TIMESTAMPTZ,
    last_known_latest_version TEXT,
    update_notification_dismissed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS profiles (
    tenant_id TEXT PRIMARY KEY,
    group_jid TEXT,
    ha_url TEXT,
    ha_token TEXT,
    google_calendar_id TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whitelists (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    alias_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, phone_number)
);

-- Config key/value store (env overrides from dashboard settings, cron markers, retention, etc.)
CREATE TABLE IF NOT EXISTS config (
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

-- Chat history (was chat_context in SQLite)
CREATE TABLE IF NOT EXISTS chats (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'model', 'function')),
    content TEXT NOT NULL,
    function_call TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chats_tenant_user ON chats(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_chats_tenant_user_created ON chats(tenant_id, user_id, created_at);

-- Local cache for failed operations and notes
CREATE TABLE IF NOT EXISTS cache (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cache_tenant_status ON cache(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cache_tenant_type ON cache(tenant_id, type);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_user ON audit_log(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log(tenant_id, created_at);

-- Reminders
CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    last_nudged TIMESTAMPTZ,
    nudge_count INTEGER NOT NULL DEFAULT 0,
    nudge_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_nudge_message_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminders_tenant_status ON reminders(tenant_id, status);

-- Mapping of WhatsApp message IDs to reminders (tracks ALL nudge messages, not just the latest)
CREATE TABLE IF NOT EXISTS reminder_nudge_messages (
    message_id TEXT PRIMARY KEY,
    reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nudge_msg_reminder ON reminder_nudge_messages(reminder_id);

-- Keyword-based custom responses
CREATE TABLE IF NOT EXISTS keywords (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    response TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'static' CHECK (type IN ('static', 'ai')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Postgres has no NOCASE collation shortcut — enforce case-insensitive uniqueness explicitly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_keywords_tenant_keyword_ci ON keywords(tenant_id, lower(keyword));
CREATE INDEX IF NOT EXISTS idx_keywords_tenant_enabled ON keywords(tenant_id, enabled);

-- Usage tracking for Gemini API tokens and costs
CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_timestamp ON usage_logs(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_model ON usage_logs(tenant_id, model);

-- Scheduled prompts
CREATE TABLE IF NOT EXISTS scheduled_prompts (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_prompts_tenant_enabled ON scheduled_prompts(tenant_id, enabled);

-- Home Assistant entity mappings
CREATE TABLE IF NOT EXISTS ha_mappings (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES profiles(tenant_id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    location TEXT,
    type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_ha_tenant_nickname ON ha_mappings(tenant_id, nickname);
CREATE INDEX IF NOT EXISTS idx_ha_tenant_location ON ha_mappings(tenant_id, location);

-- Seed the singleton instance row. schema_version tracks this migrations/*.sql sequence,
-- independent of the app's package.json semver (current_version is filled in by the app at
-- startup / by the data-migration script, not hardcoded here).
INSERT INTO instance (instance_id, schema_version)
VALUES ('default', 1)
ON CONFLICT (instance_id) DO NOTHING;
