/**
 * RAG 索引器 — 加载 chunks → 批量 embed → 写入 embeddings 表
 *
 * 状态流转：pending → indexing → indexed / error
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { BatchEmbeddingFn } from '../infrastructure/db/vector-store.js';

export class RagIndexer {
  constructor(
    private db: SqliteStore,
    private vectorStore: VectorStore,
    private batchEmbedFn?: BatchEmbeddingFn,
  ) {}

  /** 索引单个文件的所有 chunk */
  async indexFile(fileId: string): Promise<void> {
    if (!this.batchEmbedFn) {
      throw new Error('未配置 Embedding 函数，无法索引');
    }

    // 更新状态为 indexing
    this.db.run(
      "UPDATE knowledge_base_files SET status = 'indexing' WHERE id = ?",
      fileId,
    );

    try {
      const chunks = this.db.all<{ id: string; content: string }>(
        'SELECT id, content FROM knowledge_base_chunks WHERE file_id = ? ORDER BY chunk_index',
        fileId,
      );

      if (chunks.length === 0) {
        this.db.run(
          "UPDATE knowledge_base_files SET status = 'indexed', indexed_at = datetime('now') WHERE id = ?",
          fileId,
        );
        return;
      }

      // 批量生成 embedding
      const texts = chunks.map(c => c.content);
      const embeddings = await this.batchEmbedFn(texts);

      // 写入向量存储
      for (let i = 0; i < chunks.length; i++) {
        await this.vectorStore.indexEmbedding(chunks[i].id, embeddings[i], 'chunk');
      }

      // 更新状态为 indexed
      this.db.run(
        "UPDATE knowledge_base_files SET status = 'indexed', indexed_at = datetime('now') WHERE id = ?",
        fileId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.run(
        "UPDATE knowledge_base_files SET status = 'error', error_message = ? WHERE id = ?",
        message, fileId,
      );
      throw err;
    }
  }

  /** 索引某 Agent 下所有 pending 文件 */
  async indexAllPending(agentId: string): Promise<number> {
    const files = this.db.all<{ id: string }>(
      "SELECT id FROM knowledge_base_files WHERE agent_id = ? AND status = 'pending'",
      agentId,
    );

    let indexed = 0;
    for (const file of files) {
      try {
        await this.indexFile(file.id);
        indexed++;
      } catch {
        // 单个文件失败不影响其他文件
      }
    }
    return indexed;
  }

  /** 重新索引文件（先清理旧向量） */
  async reindexFile(fileId: string): Promise<void> {
    // 清理旧向量
    const chunks = this.db.all<{ id: string }>(
      'SELECT id FROM knowledge_base_chunks WHERE file_id = ?',
      fileId,
    );
    this.vectorStore.removeEmbeddings(chunks.map(c => c.id));

    // 重置状态
    this.db.run(
      "UPDATE knowledge_base_files SET status = 'pending', error_message = NULL, indexed_at = NULL WHERE id = ?",
      fileId,
    );

    // 重新索引
    await this.indexFile(fileId);
  }
}
