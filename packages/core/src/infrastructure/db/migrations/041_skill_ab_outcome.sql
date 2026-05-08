-- M7-Tier3 PR-T3-1a — Skill A-B 调用 outcome 表
--
-- A-B 测试期内每次 invoke_skill 调用记录一行（细粒度）：
--   - 桶位决定的 variant
--   - skill 执行结果（success / duration_ms / tool_calls_count）
--   - 用户后续打分（user_feedback，可为 NULL）
--
-- 与 skill_usage 表区别：skill_usage 是所有调用的全量审计；
-- skill_ab_outcome 只在 A-B 期内有数据，且必须按 ab_test_id 归属。
-- 评估器（PR-T3-1b）从本表跑 Mann-Whitney 检验。

CREATE TABLE IF NOT EXISTS skill_ab_outcome (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ab_test_id        INTEGER NOT NULL,
  -- 'A' | 'B'
  variant           TEXT NOT NULL,
  invoked_at        TEXT NOT NULL DEFAULT (datetime('now')),
  session_key       TEXT,
  agent_id          TEXT,
  -- 0 / 1 / NULL（NULL 时表示尚未确定，与 skill_usage.success 语义一致）
  success           INTEGER,
  duration_ms       INTEGER,
  tool_calls_count  INTEGER,
  -- 1 / -1 / NULL（用户 👍 / 👎 / 未反馈）
  user_feedback     INTEGER,
  FOREIGN KEY (ab_test_id) REFERENCES skill_ab_test(id)
);

-- 评估器主查询：按 ab_test_id + variant 聚合 success/duration（高频）
CREATE INDEX IF NOT EXISTS idx_skill_ab_outcome_test
  ON skill_ab_outcome(ab_test_id, variant);
