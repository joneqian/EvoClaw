-- 工作区状态追踪 (BOOTSTRAP 生命周期等)
CREATE TABLE IF NOT EXISTS workspace_state (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, key)
);
CREATE INDEX IF NOT EXISTS idx_workspace_state_agent ON workspace_state(agent_id);
