-- bindings 表 — Agent 与渠道的绑定关系
CREATE TABLE IF NOT EXISTS bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  account_id TEXT,
  peer_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bindings_agent ON bindings(agent_id);
CREATE INDEX IF NOT EXISTS idx_bindings_channel ON bindings(channel, account_id, peer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bindings_default ON bindings(is_default) WHERE is_default = 1;
