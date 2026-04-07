-- 会话运行时状态持久化 — 恢复 FileStateCache / CollapseState / 模型覆盖等
CREATE TABLE IF NOT EXISTS session_runtime_state (
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  state_key TEXT NOT NULL,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, session_key, state_key),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
