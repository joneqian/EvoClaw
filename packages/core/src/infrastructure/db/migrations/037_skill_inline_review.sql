-- P1-B Phase 2: Skill 信号驱动 Inline Review
-- 为信号驱动的 Inline Review 通路扩展 telemetry：
--   1) skill_evolution_log.trigger_source: 'cron' | 'inline'，区分两套 evolver 的来源（默认 'cron' 兼容历史）
--   2) skill_usage.conversational_feedback: 用户对话中的负反馈原文（截断 200 字，PII 已过滤）
--   3) skill_usage.inline_review_triggered_at: ISO 时间戳，限速去重 + 防递归

ALTER TABLE skill_evolution_log ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'cron';
ALTER TABLE skill_usage ADD COLUMN conversational_feedback TEXT;
ALTER TABLE skill_usage ADD COLUMN inline_review_triggered_at TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_evolution_log_trigger
  ON skill_evolution_log(trigger_source);

CREATE INDEX IF NOT EXISTS idx_skill_usage_inline_review
  ON skill_usage(skill_name, inline_review_triggered_at)
  WHERE inline_review_triggered_at IS NOT NULL;
