import { describe, it, expect, afterEach, vi } from 'vitest';
import { EmbeddingProvider, createEmbeddingProvider, DEFAULT_EMBEDDING_MODELS } from '../rag/embedding-provider.js';

/** Mock fetch */
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('EmbeddingProvider', () => {
  afterEach(() => {
    mockFetch.mockReset();
  });

  it('generate 应正确调用 /v1/embeddings 并返回 Float32Array', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    });

    const provider = new EmbeddingProvider({
      baseUrl: 'https://api.test.com',
      apiKey: 'test-key',
      model: 'text-embedding-3-small',
      dimension: 1536,
    });

    const result = await provider.generate('hello');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(0.1);

    // 验证 fetch 调用
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-key',
        }),
      }),
    );
  });

  it('generate 在 API 错误时应抛出异常', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    const provider = new EmbeddingProvider({
      baseUrl: 'https://api.test.com',
      apiKey: 'test-key',
      model: 'test',
      dimension: 1536,
    });

    await expect(provider.generate('hello')).rejects.toThrow('Embedding API 错误 (429)');
  });

  it('generate 在返回格式异常时应抛出异常', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const provider = new EmbeddingProvider({
      baseUrl: 'https://api.test.com',
      apiKey: 'key',
      model: 'test',
      dimension: 1536,
    });

    await expect(provider.generate('hello')).rejects.toThrow('Embedding API 返回格式异常');
  });

  it('generateBatch 应分批调用并按 index 排序', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.3, 0.4], index: 1 },
          { embedding: [0.1, 0.2], index: 0 },
        ],
      }),
    });

    const provider = new EmbeddingProvider({
      baseUrl: 'https://api.test.com',
      apiKey: 'key',
      model: 'test',
      dimension: 2,
    });

    const results = await provider.generateBatch(['hello', 'world'], 10);
    expect(results.length).toBe(2);
    // 按 index 排序：index 0 的 [0.1, 0.2] 在前
    expect(results[0][0]).toBeCloseTo(0.1);
    expect(results[1][0]).toBeCloseTo(0.3);
  });

  it('dimension getter 应返回配置的维度', () => {
    const provider = new EmbeddingProvider({
      baseUrl: 'https://api.test.com',
      apiKey: 'key',
      model: 'test',
      dimension: 768,
    });
    expect(provider.dimension).toBe(768);
  });

  it('createEmbeddingProvider 工厂函数应使用默认配置', () => {
    const provider = createEmbeddingProvider('https://api.openai.com', 'key', 'openai');
    expect(provider.dimension).toBe(DEFAULT_EMBEDDING_MODELS.openai.dimension);
  });
});
