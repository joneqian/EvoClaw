-- M7 Phase 2: Skill 调用 telemetry + per-skill session 摘要
-- 每次 invoke_skill（inline/fork）后写一条 skill_usage；session 结束 hook 写一条 skill_usage_summary。

CREATE TABLE IF NOT EXISTS skill_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name        TEXT NOT NULL,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key       TEXT NOT NULL,                               -- M8 session 隔离
  invoked_at        TEXT NOT NULL DEFAULT (datetime('now')),

  -- 执行结果
  trigger_type      TEXT NOT NULL,                               -- 'invoke_skill' | 'heartbeat' | 'cron'
  execution_mode    TEXT NOT NULL,                               -- 'inline' | 'fork'
  tool_calls_count  INTEGER DEFAULT 0,
  success           INTEGER NOT NULL DEFAULT 1,                  -- 1=成功, 0=失败
  duration_ms       INTEGER,
  input_tokens      INTEGER,                                     -- fork 模式可填
  output_tokens     INTEGER,
  error_summary     TEXT,                                        -- 失败时的简短描述（PII 已过滤）

  -- 用户反馈（可选，来自前端）
  user_feedback     INTEGER,                                     -- NULL / 1 (like) / -1 (dislike)
  feedback_note     TEXT                                         -- PII 已过滤
);

CREATE INDEX IF NOT EXISTS idx_skill_usage_name    ON skill_usage(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_usage_agent   ON skill_usage(agent_id);
CREATE INDEX IF NOT EXISTS idx_skill_usage_session ON skill_usage(session_key);
CREATE INDEX IF NOT EXISTS idx_skill_usage_invoked ON skill_usage(invoked_at);

-- Session 级别的 Skill 摘要（LLM 生成，为 Phase 3 Evolver 提供证据）
CREATE TABLE IF NOT EXISTS skill_usage_summary (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name        TEXT NOT NULL,
  session_key       TEXT NOT NULL,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  summary_text      TEXT NOT NULL,                               -- 8-15 句 LLM 生成的摘要
  invocation_count  INTEGER NOT NULL,
  success_rate      REAL NOT NULL,                               -- 0.0-1.0
  tools_used        TEXT,                                        -- JSON 数组（工具名）
  summarized_at     TEXT NOT NULL DEFAULT (datetime('now')),
  model_used        TEXT                                         -- 辅助模型标识
);

CREATE INDEX IF NOT EXISTS idx_skill_summary_name    ON skill_usage_summary(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_summary_session ON skill_usage_summary(session_key);
