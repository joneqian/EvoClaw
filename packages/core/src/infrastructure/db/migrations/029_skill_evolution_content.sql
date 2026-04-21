-- M7.1: skill_evolution_log 增加 previous_content + new_content 列，支持前端 diff 预览 + 一键回滚
-- 只在 decision IN ('refine','create') 时填充，skip 保持 NULL

ALTER TABLE skill_evolution_log ADD COLUMN previous_content TEXT;
ALTER TABLE skill_evolution_log ADD COLUMN new_content TEXT;
