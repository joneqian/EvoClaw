-- 审计日志新增决策原因字段
ALTER TABLE tool_audit_log ADD COLUMN reason TEXT;
