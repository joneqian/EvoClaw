-- M13 Phase 5 C4: 飞书文档块编辑审计日志
--
-- 每次 agent 通过工具替换/删除 docx block 时落盘 (timestamp, agentId, accountId,
-- fileToken, blockId, action, before_text, after_text, document_revision_id)。
--
-- 用途：
-- - v1：调试 / 取证（agent 改坏文档时人工查日志手动恢复）
-- - v2：暴露撤销工具 feishu_undo_doc_edit(file_token, count) 让 agent 自助回退
--
-- 不做 FK / cascade —— audit 是只读历史记录，不应受其它表删除影响。

CREATE TABLE IF NOT EXISTS doc_edit_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  agent_id TEXT,
  account_id TEXT NOT NULL,
  file_token TEXT NOT NULL,
  block_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('replace', 'delete', 'append')),
  before_text TEXT,
  after_text TEXT,
  document_revision_id INTEGER
);

-- 按文档 + 时间倒序查询最近 N 条编辑（撤销路径主用）
CREATE INDEX IF NOT EXISTS idx_doc_edit_audit_file_token_ts
  ON doc_edit_audit(file_token, ts DESC);

-- 按 agent 查所有编辑（取证）
CREATE INDEX IF NOT EXISTS idx_doc_edit_audit_agent_ts
  ON doc_edit_audit(agent_id, ts DESC);
