-- Noga Database Schema

-- Configuration storage
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat context for maintaining conversation history
CREATE TABLE IF NOT EXISTS chat_context (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'model', 'function')),
    content TEXT NOT NULL,
    function_call TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Local cache for failed operations and notes
CREATE TABLE IF NOT EXISTS cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log for tracking bot actions
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Keyword-based custom responses
CREATE TABLE IF NOT EXISTS keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL UNIQUE COLLATE NOCASE,
    response TEXT NOT NULL,
    type TEXT DEFAULT 'static' CHECK(type IN ('static', 'ai')),
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_context(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_context(created_at);
CREATE INDEX IF NOT EXISTS idx_cache_status ON cache(status);
CREATE INDEX IF NOT EXISTS idx_cache_type ON cache(type);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);

-- Usage tracking for Gemini API tokens and costs
CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    model TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);
