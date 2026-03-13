CREATE TABLE IF NOT EXISTS tool_audit_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','error','denied','timeout')),
  duration_ms INTEGER,
  permission_id TEXT REFERENCES permissions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_audit_agent ON tool_audit_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_tool_audit_session ON tool_audit_log(session_key);
