-- cron_jobs 表 — Agent 定时任务
CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'tool', 'pipeline')),
  action_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cron_agent ON cron_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_cron_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
