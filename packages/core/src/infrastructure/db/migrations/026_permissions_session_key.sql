-- M8: permissions 表增加 session_key 列，实现会话级权限隔离
-- - scope='session' 记录必须填 session_key（同 session 内复用授权）
-- - scope='always'/'deny' 保持 session_key=NULL（跨 session 复用）
-- - scope='once' 语义不变（一次性消费后删除）

ALTER TABLE permissions ADD COLUMN session_key TEXT;

-- 新索引：按 (agent, session, category) 查询 session 作用域权限
CREATE INDEX IF NOT EXISTS idx_permissions_agent_session_cat
  ON permissions(agent_id, session_key, category, resource);

-- 旧库清理：升级前的 scope='session' 记录无 session_key，无法按 session 定位，
-- 一次性删除以确保新语义一致（这些记录本来就是历史残留，影响面小）
DELETE FROM permissions WHERE scope = 'session' AND session_key IS NULL;

-- audit_log 表增加 session_key 列（追溯授权/撤销操作发生的 session）
ALTER TABLE audit_log ADD COLUMN session_key TEXT;
