-- Core tables
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  soul_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  channel TEXT DEFAULT 'desktop',
  channel_session_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_id TEXT,
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Security
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  resource TEXT,
  result TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

-- Model configs
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  config TEXT,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_conversations_agent ON conversations(agent_id);
CREATE INDEX idx_audit_log_agent ON audit_log(agent_id, created_at);
