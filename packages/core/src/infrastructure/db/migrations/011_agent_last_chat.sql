-- agents 表增加最近对话时间字段，用于排序
ALTER TABLE agents ADD COLUMN last_chat_at TEXT;

-- 从现有 conversation_log 回填
UPDATE agents SET last_chat_at = (
  SELECT MAX(created_at) FROM conversation_log WHERE conversation_log.agent_id = agents.id
);
