-- 会话摘要表 — 持久化 Session Memory 周期性笔记
CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  token_count_at INTEGER NOT NULL,
  turn_count_at INTEGER NOT NULL,
  tool_call_count_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_summary_key ON session_summaries(agent_id, session_key);
