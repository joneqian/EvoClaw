import { describe, it, expect, vi } from 'vitest';
import { VectorStore } from '../infrastructure/db/vector-store.js';

/** 创建简单的 4 维向量 */
function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('VectorStore', () => {
  // ---------- indexEmbedding + search 往返 ----------

  it('indexEmbedding + search 应能完成索引与检索往返', async () => {
    const store = new VectorStore();
    const embedding = vec(1, 0, 0, 0);
    await store.indexEmbedding('mem-001', embedding);

    // 用相同方向的查询向量搜索
    const results = await store.search(vec(1, 0, 0, 0));
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('mem-001');
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  // ---------- 余弦相似度正确性：相同向量 → ~1.0 ----------

  it('相同向量的余弦相似度应接近 1.0', async () => {
    const store = new VectorStore();
    const embedding = vec(0.5, 0.3, 0.7, 0.1);
    await store.indexEmbedding('mem-identical', embedding);

    const results = await store.search(vec(0.5, 0.3, 0.7, 0.1));
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  // ---------- 正交向量 → ~0.0 ----------

  it('正交向量的余弦相似度应接近 0.0', async () => {
    const store = new VectorStore();
    // (1,0,0,0) 和 (0,1,0,0) 互相正交
    await store.indexEmbedding('mem-ortho', vec(0, 1, 0, 0));

    const results = await store.search(vec(1, 0, 0, 0));
    expect(results[0].score).toBeCloseTo(0.0, 5);
  });

  // ---------- search 带 limit ----------

  it('search 应遵守 limit 参数', async () => {
    const store = new VectorStore();
    // 索引 5 条向量
    for (let i = 0; i < 5; i++) {
      const v = vec(0, 0, 0, 0);
      v[i % 4] = 1; // 循环设置不同维度
      await store.indexEmbedding(`mem-${i}`, v);
    }

    const results = await store.search(vec(1, 0, 0, 0), 2);
    expect(results.length).toBe(2);
  });

  // ---------- removeEmbedding ----------

  it('removeEmbedding 后该向量不再出现在搜索结果中', async () => {
    const store = new VectorStore();
    await store.indexEmbedding('mem-del', vec(1, 1, 1, 1));

    store.removeEmbedding('mem-del');

    const results = await store.search(vec(1, 1, 1, 1));
    expect(results.length).toBe(0);
  });

  // ---------- size 属性 ----------

  it('size 属性应返回已索引的向量数量', async () => {
    const store = new VectorStore();
    expect(store.size).toBe(0);

    await store.indexEmbedding('mem-a', vec(1, 0, 0, 0));
    expect(store.size).toBe(1);

    await store.indexEmbedding('mem-b', vec(0, 1, 0, 0));
    expect(store.size).toBe(2);

    store.removeEmbedding('mem-a');
    expect(store.size).toBe(1);
  });

  // ---------- indexText 使用 mock embeddingFn ----------

  it('indexText 应调用 embeddingFn 并索引生成的向量', async () => {
    const mockEmbeddingFn = vi.fn().mockResolvedValue(vec(0.5, 0.5, 0.5, 0.5));
    const store = new VectorStore(mockEmbeddingFn);

    await store.indexText('mem-text', '这是一段测试文本');

    // 验证 embeddingFn 被调用
    expect(mockEmbeddingFn).toHaveBeenCalledWith('这是一段测试文本');
    expect(store.size).toBe(1);

    // 搜索应能找到
    const results = await store.search(vec(0.5, 0.5, 0.5, 0.5));
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('mem-text');
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  // ---------- indexText 无 embeddingFn 时静默跳过 ----------

  it('indexText 在没有 embeddingFn 时应静默跳过', async () => {
    const store = new VectorStore(); // 无 embeddingFn
    await store.indexText('mem-skip', '不会被索引的文本');
    expect(store.size).toBe(0);
  });
});
