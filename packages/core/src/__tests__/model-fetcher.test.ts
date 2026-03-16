import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchModelsFromApi } from '../provider/model-fetcher.js';

describe('fetchModelsFromApi', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('成功拉取模型列表并过滤非聊天模型', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o', object: 'model' },
          { id: 'gpt-4o-mini', object: 'model' },
          { id: 'text-embedding-3-small', object: 'model' },
          { id: 'dall-e-3', object: 'model' },
          { id: 'whisper-1', object: 'model' },
          { id: 'tts-1', object: 'model' },
        ],
      }),
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'sk-test', 'openai');

    expect(result.success).toBe(true);
    expect(result.source).toBe('api');
    // 应过滤掉 embedding, dall-e, whisper, tts
    expect(result.models).toHaveLength(2);
    expect(result.models.map(m => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('模型应有正确的 provider 和默认 isDefault', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'model-a' },
          { id: 'model-b' },
        ],
      }),
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'sk-test', 'minimax');

    expect(result.models[0]!.provider).toBe('minimax');
    expect(result.models[0]!.isDefault).toBe(true);
    expect(result.models[1]!.isDefault).toBe(false);
  });

  it('应解析 API 提供的 capabilities', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'advanced-model',
            max_context_length: 200000,
            max_tokens: 16384,
            capabilities: { vision: true, tool_use: true },
          },
        ],
      }),
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'sk-test', 'test');

    expect(result.models[0]!.maxContextLength).toBe(200000);
    expect(result.models[0]!.maxOutputTokens).toBe(16384);
    expect(result.models[0]!.supportsVision).toBe(true);
    expect(result.models[0]!.supportsToolUse).toBe(true);
  });

  it('HTTP 错误应返回 success=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'bad-key', 'test');

    expect(result.success).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.error).toContain('401');
  });

  it('网络错误应返回 success=false', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await fetchModelsFromApi('https://unreachable.example.com/v1', 'sk-test', 'test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('响应格式异常应返回 success=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: 'format' }),
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'sk-test', 'test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('无法识别模型列表');
  });

  it('空模型列表应返回 success=false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'sk-test', 'test');

    expect(result.success).toBe(false);
    expect(result.models).toHaveLength(0);
  });

  it('应使用正确的请求头', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'test-model' }] }),
    });
    globalThis.fetch = mockFetch;

    await fetchModelsFromApi('https://api.example.com/v1', 'sk-my-key', 'test');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-my-key',
        }),
      }),
    );
  });

  it('应根据模型 ID 猜测 vision 能力', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'qwen-vl-max' },
          { id: 'plain-chat' },
        ],
      }),
    });

    const result = await fetchModelsFromApi('https://api.example.com/v1', 'sk-test', 'test');

    expect(result.models.find(m => m.id === 'qwen-vl-max')!.supportsVision).toBe(true);
    expect(result.models.find(m => m.id === 'plain-chat')!.supportsVision).toBe(false);
  });
});
