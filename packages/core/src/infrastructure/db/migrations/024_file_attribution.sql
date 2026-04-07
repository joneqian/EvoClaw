-- 文件操作追踪 — 记录 Agent 会话中的文件 Read/Write/Edit/Create/Delete 操作
CREATE TABLE IF NOT EXISTS file_attributions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  file_path TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write', 'edit', 'create', 'delete')),
  content_hash TEXT,
  turn_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_attr_session
  ON file_attributions(agent_id, session_key);
CREATE INDEX IF NOT EXISTS idx_file_attr_path
  ON file_attributions(file_path, agent_id);
