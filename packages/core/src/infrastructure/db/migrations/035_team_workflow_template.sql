-- M13 Roster 驱动的工作流懒加载（PR for issue: 协调者跳过产品经理 + PRD 幻觉）
--
-- 两处变更：
--   1. tasks.expected_artifact_kinds: 任务声明自己将产出哪几类 artifact（JSON 数组），
--      用于 <active_plans> "期望 vs 实际" 对账，让下游 LLM 看出上游产物是否真的交付。
--      软约束：service 不强校验，仅 prompt 渲染消费。
--
--   2. agents.team_workflow_json: 协调者自助生成的团队工作流模板（懒加载）。
--      第一次被叫出来时为 NULL → prompt 注入 <workflow_bootstrap_required>，
--      引导协调者看 roster + 跟用户对话敲定后调 propose_team_workflow 落盘。
--      非协调者忽略此列。

ALTER TABLE tasks ADD COLUMN expected_artifact_kinds TEXT;

ALTER TABLE agents ADD COLUMN team_workflow_json TEXT;
