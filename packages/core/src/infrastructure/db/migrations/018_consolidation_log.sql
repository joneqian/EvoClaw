-- 记忆整合日志表 — 跟踪 AutoDream 整合执行记录
CREATE TABLE IF NOT EXISTS consolidation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running|completed|failed
  memories_merged INTEGER DEFAULT 0,
  memories_pruned INTEGER DEFAULT 0,
  memories_created INTEGER DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_consolidation_agent ON consolidation_log(agent_id, started_at DESC);
