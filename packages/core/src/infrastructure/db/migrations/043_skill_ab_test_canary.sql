-- M7-Tier3 PR-T3-2b — Skill A-B Canary 模式标记
--
-- mode='canary' 时 evolver 启动 A-B 测试但桶位偏置：
--   默认 90% 流量继续读旧版本（A 桶，从 .ab-cache 读），
--   10% 流量看新版本（B 桶，读 SKILL.md 磁盘）。
--   评估器（PR-T3-1b）行为不变，达到 min_calls 或 max_test_days 后跑
--   Mann-Whitney 自动 promote/rollback。
--
-- 设计取舍（详见 docs/iteration-plans/M7-Tier3.2-Plan.md §2）：
--   - 复用 skill_ab_test 表 + assignBucket 桶位算法 + .ab-cache 物化
--   - 只加两列标记 canary 状态 — 比例 0.05~0.5 由 schema 范围限制
--   - 应用层校验：is_canary=0 时 canary_ratio_b 应为 NULL（SQLite 限制
--     ALTER ADD CHECK，由 store 层兜底）

ALTER TABLE skill_ab_test ADD COLUMN is_canary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_ab_test ADD COLUMN canary_ratio_b REAL;
