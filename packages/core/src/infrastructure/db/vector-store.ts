/** 向量搜索结果 */
export interface VectorSearchResult {
  memoryId: string;
  score: number; // cosine similarity 0-1
}

/** 嵌入生成函数签名 */
export type EmbeddingFn = (text: string) => Promise<Float32Array>;

/**
 * 向量存储 — 当前使用内存 Map + cosine similarity 作为 fallback
 * 后续可替换为 sqlite-vec 扩展
 */
export class VectorStore {
  private embeddings = new Map<string, Float32Array>();

  constructor(private embeddingFn?: EmbeddingFn) {}

  /** 索引一条向量 */
  async indexEmbedding(
    memoryId: string,
    embedding: Float32Array,
  ): Promise<void> {
    this.embeddings.set(memoryId, embedding);
  }

  /** 根据文本生成嵌入并索引 */
  async indexText(memoryId: string, text: string): Promise<void> {
    if (!this.embeddingFn) return;
    const embedding = await this.embeddingFn(text);
    this.embeddings.set(memoryId, embedding);
  }

  /** 向量相似度搜索 */
  async search(
    queryEmbedding: Float32Array,
    limit: number = 20,
  ): Promise<VectorSearchResult[]> {
    const results: VectorSearchResult[] = [];

    for (const [memoryId, embedding] of this.embeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding);
      results.push({ memoryId, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** 删除向量 */
  removeEmbedding(memoryId: string): void {
    this.embeddings.delete(memoryId);
  }

  /** 获取已索引数量 */
  get size(): number {
    return this.embeddings.size;
  }
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
