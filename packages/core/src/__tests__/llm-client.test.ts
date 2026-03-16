/**
 * LLM Client 单元测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callLLM } from '../agent/llm-client.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';

/** 创建 mock ConfigManager */
function mockConfigManager(overrides?: Partial<Record<string, string>>): ConfigManager {
  return {
    getDefaultApiKey: () => overrides?.apiKey ?? 'test-key',
    getDefaultBaseUrl: () => overrides?.baseUrl ?? 'https://api.example.com/v1',
    getDefaultModelId: () => overrides?.modelId ?? 'gpt-4o-mini',
    getDefaultApi: () => overrides?.api ?? 'openai-completions',
  } as unknown as ConfigManager;
}

describe('callLLM', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未配置时应抛出错误', async () => {
    const cm = mockConfigManager({ apiKey: '', baseUrl: '', modelId: '' });
    await expect(callLLM(cm, {
      systemPrompt: 'test',
      userMessage: 'test',
    })).rejects.toThrow('LLM 未配置');
  });

  it('OpenAI 协议：发送正确的请求格式', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '生成的内容' } }],
      }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const result = await callLLM(mockConfigManager(), {
      systemPrompt: '你是专家',
      userMessage: '生成文件',
    });

    expect(result).toBe('生成的内容');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":false'),
      }),
    );

    // 验证请求体结构
    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: '你是专家' });
    expect(body.messages[1]).toEqual({ role: 'user', content: '生成文件' });
    expect(body.stream).toBe(false);
  });

  it('Anthropic 协议：发送正确的请求格式', async () => {
    const cm = mockConfigManager({
      api: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com/v1',
      modelId: 'claude-sonnet-4-6',
    });

    const mockResponse = {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Anthropic 生成内容' }],
      }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const result = await callLLM(cm, {
      systemPrompt: '你是专家',
      userMessage: '生成文件',
    });

    expect(result).toBe('Anthropic 生成内容');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    );

    // 验证 Anthropic 头部
    const call = vi.mocked(fetch).mock.calls[0];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('API 返回错误时抛出异常', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as Response);

    await expect(callLLM(mockConfigManager(), {
      systemPrompt: 'test',
      userMessage: 'test',
    })).rejects.toThrow('LLM 调用失败: HTTP 401');
  });
});
