CREATE TABLE IF NOT EXISTS conversation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  compaction_status TEXT NOT NULL DEFAULT 'raw' CHECK (compaction_status IN ('raw','extracted','compacted','archived')),
  compaction_ref TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_convlog_agent_session ON conversation_log(agent_id, session_key);
CREATE INDEX IF NOT EXISTS idx_convlog_status ON conversation_log(agent_id, compaction_status);
