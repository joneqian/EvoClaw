-- 为 conversation_log 添加工具调用元数据列
-- 存储 JSON 数组: [{"name":"bash","status":"done","summary":"$ find ..."}]
ALTER TABLE conversation_log ADD COLUMN tool_calls_json TEXT;
