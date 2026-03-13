CREATE TABLE IF NOT EXISTS memory_units (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT,
  l0_index TEXT NOT NULL,           -- ~50 tokens summary
  l1_overview TEXT NOT NULL,        -- ~500-2K tokens structured overview
  l2_content TEXT NOT NULL,         -- full content
  category TEXT NOT NULL CHECK (category IN ('profile','preference','entity','event','case','pattern','tool','skill','correction')),
  merge_type TEXT NOT NULL CHECK (merge_type IN ('merge','independent')),
  merge_key TEXT,                   -- null for independent type
  scope TEXT NOT NULL DEFAULT 'private',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','channel_only')),
  visibility_channels TEXT,         -- JSON array of channel IDs
  activation REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_access_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  source_session_key TEXT,
  source_message_ids TEXT,          -- JSON array
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_units(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_units(agent_id, category);
CREATE INDEX IF NOT EXISTS idx_memory_merge_key ON memory_units(agent_id, merge_key) WHERE merge_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_activation ON memory_units(agent_id, activation DESC);
