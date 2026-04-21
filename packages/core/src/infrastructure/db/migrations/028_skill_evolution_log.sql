-- M7 Phase 3: Agentic Evolver 决策审计表
-- 每次 cycle 对每个候选 Skill 的决策（refine/create/skip）都写一条。
-- previous_hash / new_hash 支持人工回滚：SELECT previous_content 从历史 Skill 快照重建。

CREATE TABLE IF NOT EXISTS skill_evolution_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name         TEXT NOT NULL,
  evolved_at         TEXT NOT NULL DEFAULT (datetime('now')),
  decision           TEXT NOT NULL,         -- 'refine' | 'create' | 'skip'
  reasoning          TEXT,                  -- 2-3 句 LLM 说明（已过滤 PII）
  evidence_count     INTEGER NOT NULL,      -- 参与决策的证据条数
  evidence_summary   TEXT,                  -- 证据 JSON（invocations/summaries/feedback）
  patches_applied    TEXT,                  -- refine: JSON [{old, new}]；create: JSON { name }
  previous_hash      TEXT,                  -- 改动前 SHA-256（skip 也记录当前 hash 便于审计）
  new_hash           TEXT,                  -- 改动后 SHA-256（skip/失败为 NULL）
  model_used         TEXT,                  -- 辅助模型 id
  duration_ms        INTEGER,
  error_message      TEXT,                  -- 执行失败的原因（安全扫描拒绝 / patch 不匹配 / 等）
  rolled_back        INTEGER NOT NULL DEFAULT 0   -- 1 = 人工标记回滚过
);

CREATE INDEX IF NOT EXISTS idx_evolution_skill ON skill_evolution_log(skill_name);
CREATE INDEX IF NOT EXISTS idx_evolution_date  ON skill_evolution_log(evolved_at);
