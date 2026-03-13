CREATE TABLE IF NOT EXISTS capability_graph (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  level REAL NOT NULL DEFAULT 0.0,
  use_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0.0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, capability)
);
