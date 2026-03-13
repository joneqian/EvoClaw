CREATE TABLE IF NOT EXISTS knowledge_graph (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT,
  subject_id TEXT NOT NULL,         -- memory_unit id or entity name
  predicate TEXT NOT NULL,          -- relation type
  object_id TEXT NOT NULL,          -- memory_unit id or entity name
  object_literal TEXT,              -- optional literal value
  confidence REAL NOT NULL DEFAULT 0.5,
  source_memory_id TEXT REFERENCES memory_units(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kg_agent ON knowledge_graph(agent_id);
CREATE INDEX IF NOT EXISTS idx_kg_subject ON knowledge_graph(subject_id, predicate);
CREATE INDEX IF NOT EXISTS idx_kg_object ON knowledge_graph(object_id, predicate);
