-- 对话日志层级关系扩展 — 支持多 Agent 消息追踪
-- 新增字段: parent_message_id, is_sidechain, entry_type

ALTER TABLE conversation_log ADD COLUMN parent_message_id TEXT;
ALTER TABLE conversation_log ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_log ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'message';

-- 子代理消息查询索引
CREATE INDEX IF NOT EXISTS idx_convlog_parent ON conversation_log(parent_message_id) WHERE parent_message_id IS NOT NULL;
-- 按条目类型过滤（如查询所有压缩边界事件）
CREATE INDEX IF NOT EXISTS idx_convlog_entry_type ON conversation_log(agent_id, entry_type) WHERE entry_type != 'message';
