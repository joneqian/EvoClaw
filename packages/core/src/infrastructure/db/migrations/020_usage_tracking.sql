-- 使用量追踪表 — 记录每次 LLM API 调用的 token 消耗和成本
CREATE TABLE IF NOT EXISTS usage_tracking (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  session_key     TEXT,
  channel         TEXT NOT NULL DEFAULT 'desktop',
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  -- Token 统计
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  -- 成本估算（单位：千分之一分人民币，避免浮点精度问题）
  estimated_cost_milli INTEGER NOT NULL DEFAULT 0,
  -- 调用类型
  call_type       TEXT NOT NULL DEFAULT 'chat',  -- chat|memory_extract|compression|embedding|consolidation|summary|tool_summary
  -- 结果
  success         INTEGER NOT NULL DEFAULT 1,
  error_code      TEXT,
  latency_ms      INTEGER,
  -- 轮次信息
  turn_count      INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_agent_date ON usage_tracking(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_tracking(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_tracking(model, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_tracking(session_key, created_at);
