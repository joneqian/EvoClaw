-- Memory & Evolution tables for Sprint 2

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT,
  key TEXT,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  observed_count INTEGER DEFAULT 1,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX idx_memories_agent ON memories(agent_id, type);
