-- 增量持久化扩展 — 支持 queryLoop 逐轮消息写入 + 崩溃恢复
-- 新增字段: turn_index, kernel_message_json, persist_status

ALTER TABLE conversation_log ADD COLUMN turn_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_log ADD COLUMN kernel_message_json TEXT;
ALTER TABLE conversation_log ADD COLUMN persist_status TEXT NOT NULL DEFAULT 'final'
  CHECK (persist_status IN ('streaming', 'final', 'orphaned'));

-- 流式消息恢复查询索引（仅索引非 final 状态，减少索引体积）
CREATE INDEX IF NOT EXISTS idx_convlog_persist
  ON conversation_log(agent_id, session_key, persist_status)
  WHERE persist_status != 'final';
