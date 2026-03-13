-- agents 表
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🤖',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  config_json TEXT NOT NULL DEFAULT '{}',
  workspace_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- permissions 表
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('file_read', 'file_write', 'network', 'shell', 'browser', 'mcp', 'skill')),
  scope TEXT NOT NULL CHECK (scope IN ('once', 'session', 'always', 'deny')),
  resource TEXT NOT NULL DEFAULT '*',
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  granted_by TEXT NOT NULL DEFAULT 'user' CHECK (granted_by IN ('user', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_permissions_agent ON permissions(agent_id);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(agent_id, category);

-- model_configs 表
CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  api_key_ref TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_default ON model_configs(provider, is_default) WHERE is_default = 1;

-- audit_log 表
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);
