-- audit_log 表增加安全检测所需的字段
ALTER TABLE audit_log ADD COLUMN category TEXT;
ALTER TABLE audit_log ADD COLUMN resource TEXT;
ALTER TABLE audit_log ADD COLUMN result TEXT;
