-- Cron 错误追踪与状态机
-- 连续失败计数 + 执行状态 + 投递状态
ALTER TABLE cron_jobs ADD COLUMN consecutive_errors INTEGER DEFAULT 0;
ALTER TABLE cron_jobs ADD COLUMN last_run_status TEXT DEFAULT NULL;
ALTER TABLE cron_jobs ADD COLUMN last_delivery_status TEXT DEFAULT NULL;
