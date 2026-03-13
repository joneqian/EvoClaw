/**
 * 向量存储 — SQLite BLOB 持久化 + JS 暴力 cosine similarity
 *
 * 桌面单用户场景 (<50K 向量)，~15ms 完成搜索。
 * 支持 memory / chunk 两种 sourceType。
 */

import type { SqliteStore } from './sqlite-store.js';
import type { EmbeddingSourceType } from '@evoclaw/shared';

/** 向量搜索结果 */
export interface VectorSearchResult {
  memoryId: string;
  score: number; // cosine similarity 0-1
}

/** 嵌入生成函数签名 */
export type EmbeddingFn = (text: string) => Promise<Float32Array>;

/** 批量嵌入函数签名 */
export type BatchEmbeddingFn = (texts: string[]) => Promise<Float32Array[]>;

/**
 * 向量存储 — SQLite BLOB 持久化
 * 如果未提供 db，回退到内存 Map（向后兼容测试场景）
 */
export class VectorStore {
  private memoryFallback: Map<string, Float32Array> | null = null;

  constructor(
    private db?: SqliteStore,
    private embeddingFn?: EmbeddingFn,
  ) {
    if (!db) {
      this.memoryFallback = new Map();
    }
  }

  /** 索引一条向量 */
  async indexEmbedding(
    id: string,
    embedding: Float32Array,
    sourceType: EmbeddingSourceType = 'memory',
  ): Promise<void> {
    if (this.memoryFallback) {
      this.memoryFallback.set(id, embedding);
      return;
    }

    const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db!.run(
      `INSERT OR REPLACE INTO embeddings (id, source_type, embedding, dimension, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      id, sourceType, blob, embedding.length,
    );
  }

  /** 根据文本生成嵌入并索引 */
  async indexText(
    id: string,
    text: string,
    sourceType: EmbeddingSourceType = 'memory',
  ): Promise<void> {
    if (!this.embeddingFn) return;
    const embedding = await this.embeddingFn(text);
    await this.indexEmbedding(id, embedding, sourceType);
  }

  /** 向量相似度搜索 */
  async search(
    queryEmbedding: Float32Array,
    limit: number = 20,
    sourceType?: EmbeddingSourceType,
  ): Promise<VectorSearchResult[]> {
    if (this.memoryFallback) {
      return this.searchInMemory(queryEmbedding, limit);
    }

    // 从 DB 加载所有匹配 sourceType 的向量
    const condition = sourceType ? 'WHERE source_type = ?' : '';
    const params = sourceType ? [sourceType] : [];
    const rows = this.db!.all<{ id: string; embedding: Buffer }>(
      `SELECT id, embedding FROM embeddings ${condition}`,
      ...params,
    );

    const results: VectorSearchResult[] = [];
    for (const row of rows) {
      const stored = blobToFloat32Array(row.embedding);
      const score = cosineSimilarity(queryEmbedding, stored);
      results.push({ memoryId: row.id, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** 根据文本搜索（便捷方法） */
  async searchByText(
    query: string,
    limit: number = 20,
    sourceType?: EmbeddingSourceType,
  ): Promise<VectorSearchResult[]> {
    if (!this.embeddingFn) return [];
    const queryEmbedding = await this.embeddingFn(query);
    return this.search(queryEmbedding, limit, sourceType);
  }

  /** 删除向量 */
  removeEmbedding(id: string): void {
    if (this.memoryFallback) {
      this.memoryFallback.delete(id);
      return;
    }
    this.db!.run('DELETE FROM embeddings WHERE id = ?', id);
  }

  /** 批量删除 */
  removeEmbeddings(ids: string[]): void {
    if (ids.length === 0) return;
    if (this.memoryFallback) {
      for (const id of ids) this.memoryFallback.delete(id);
      return;
    }
    const placeholders = ids.map(() => '?').join(', ');
    this.db!.run(`DELETE FROM embeddings WHERE id IN (${placeholders})`, ...ids);
  }

  /** 获取已索引数量 */
  get size(): number {
    if (this.memoryFallback) {
      return this.memoryFallback.size;
    }
    const row = this.db!.get<{ count: number }>('SELECT COUNT(*) as count FROM embeddings');
    return row?.count ?? 0;
  }

  /** 检查是否有 embeddingFn */
  get hasEmbeddingFn(): boolean {
    return !!this.embeddingFn;
  }

  /** 内存模式搜索（向后兼容） */
  private searchInMemory(queryEmbedding: Float32Array, limit: number): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];
    for (const [memoryId, embedding] of this.memoryFallback!) {
      const score = cosineSimilarity(queryEmbedding, embedding);
      results.push({ memoryId, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}

/** BLOB → Float32Array */
function blobToFloat32Array(buf: Buffer): Float32Array {
  const uint8 = new Uint8Array(buf);
  return new Float32Array(uint8.buffer, uint8.byteOffset, uint8.byteLength / 4);
}

/** 计算余弦相似度 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
