-- 009: 知识库 + 向量持久化
-- embeddings 表：记忆+知识块共用向量存储
CREATE TABLE IF NOT EXISTS embeddings (
  id          TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('memory', 'chunk')),
  embedding   BLOB NOT NULL,
  dimension   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_embeddings_source_type ON embeddings(source_type);

-- 知识库文件表
CREATE TABLE IF NOT EXISTS knowledge_base_files (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_hash   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexing', 'indexed', 'error')),
  error_message TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  indexed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_kb_files_agent ON knowledge_base_files(agent_id);
CREATE INDEX IF NOT EXISTS idx_kb_files_hash ON knowledge_base_files(file_hash);

-- 知识库分块表
CREATE TABLE IF NOT EXISTS knowledge_base_chunks (
  id            TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL REFERENCES knowledge_base_files(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  metadata_json TEXT,
  token_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_file ON knowledge_base_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_agent ON knowledge_base_chunks(agent_id);
