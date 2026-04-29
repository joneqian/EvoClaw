-- agents 表加 is_team_coordinator 列（M13 多 Agent 协作 — 协调者配置化）
--
-- 用途：用户在桌面端 Agent 配置界面勾选"作为本群协调中心"后，系统自动注入：
--   - 自身 prompt：<my_coordination_role> 让该 Agent 知道自己是协调者
--   - 同群其他 Agent 的 prompt：<team_coordinator> 让其他 Agent 把跨角色对接交给协调者
--
-- 不开任何 Agent 时群里走平行协作模式（无协调者概念），保持系统层中性。
-- 适用场景：PM 团队、客服 trio 派单员、辩论主持人等中心节点角色；不适用扁平协作。
ALTER TABLE agents ADD COLUMN is_team_coordinator INTEGER NOT NULL DEFAULT 0;
