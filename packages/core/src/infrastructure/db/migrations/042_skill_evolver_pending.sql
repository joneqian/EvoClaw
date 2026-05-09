-- M7-Tier3 PR-T3-2a — Skill Evolver dryRun 待审核标记
--
-- mode='dryRun' 时 evolver LLM 决策落 evolution_log 但不写 SKILL.md。
-- 用户在 UI 通过 /log/:id/apply 或 /log/:id/reject 解决待审决策。
--
-- 设计取舍：
--   - 不引入新表 — pending_approval 是 evolution_log 行的状态机扩展
--   - approval_decided_by 区分 manual-apply / manual-reject，方便审计
--   - 部分索引 idx_skill_evolution_log_pending 仅覆盖 pending=1 行
--     （绝大多数查询是「待审核列表」高频场景，apply 后行变 0 自动从索引摘除）

ALTER TABLE skill_evolution_log ADD COLUMN pending_approval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_evolution_log ADD COLUMN approval_decided_at TEXT;
ALTER TABLE skill_evolution_log ADD COLUMN approval_decided_by TEXT;

-- 部分索引：高频查待审核列表
CREATE INDEX IF NOT EXISTS idx_skill_evolution_log_pending
  ON skill_evolution_log(pending_approval) WHERE pending_approval = 1;
