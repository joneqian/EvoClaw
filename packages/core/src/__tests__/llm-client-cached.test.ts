/**
 * callLLMSecondaryCached + callLLMWithBlocks 测试
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callLLMSecondaryCached, callLLMWithBlocks } from '../agent/llm-client.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';

function mockConfigManager(overrides?: Partial<Record<string, string>>): ConfigManager {
  return {
    getDefaultApiKey: () => overrides?.apiKey ?? 'test-key',
    getDefaultBaseUrl: () => overrides?.baseUrl ?? 'https://api.anthropic.com/v1',
    getDefaultModelId: () => overrides?.modelId ?? 'claude-haiku-4-5-20251001',
    getDefaultApi: () => overrides?.api ?? 'anthropic-messages',
    getDefaultProvider: () => overrides?.provider ?? 'anthropic',
    getProvider: () => ({ models: [], apiKey: 'test-key', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic-messages' }),
  } as unknown as ConfigManager;
}

describe('callLLMWithBlocks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Anthropic 协议: 传递 cache_control 到 system 字段', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '摘要结果' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const blocks = [
      { text: '你是摘要助手', cacheControl: { type: 'ephemeral' } },
      { text: '额外上下文', cacheControl: null },
    ];

    const result = await callLLMWithBlocks(mockConfigManager(), blocks, '请总结', 1024);
    expect(result).toBe('摘要结果');

    // 验证 system 字段包含 cache_control
    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.system).toHaveLength(2);
    expect(body.system[0]).toEqual({
      type: 'text',
      text: '你是摘要助手',
      cache_control: { type: 'ephemeral' },
    });
    // null cacheControl → 无 cache_control 字段
    expect(body.system[1]).toEqual({
      type: 'text',
      text: '额外上下文',
    });
  });

  it('OpenAI 协议: blocks 拼接为纯文本 system', async () => {
    const cm = mockConfigManager({ api: 'openai-completions', baseUrl: 'https://api.example.com/v1' });
    const mockResponse = {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '结果' } }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const blocks = [
      { text: 'Block A', cacheControl: { type: 'ephemeral' } },
      { text: 'Block B', cacheControl: null },
    ];

    await callLLMWithBlocks(cm, blocks, 'hello');

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    // OpenAI: messages[0].content = 两个 block 拼接
    expect(body.messages[0].content).toBe('Block A\n\nBlock B');
  });
});

describe('callLLMSecondaryCached', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('已知 taskType 使用固定 system prompt + cache_control', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '摘要' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const result = await callLLMSecondaryCached(mockConfigManager(), 'summarize', '请总结这段内容');
    expect(result).toBe('摘要');

    // 验证 system prompt 包含固定的摘要指令
    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.system[0].text).toContain('summarization assistant');
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('appendToSystem 追加为第二个 block（不缓存）', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '提取结果' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    await callLLMSecondaryCached(mockConfigManager(), 'extract', '提取数据', {
      appendToSystem: '自定义上下文',
    });

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);

    expect(body.system).toHaveLength(2);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[1].text).toBe('自定义上下文');
    // 附加 block 无 cache_control
    expect(body.system[1].cache_control).toBeUndefined();
  });

  it('tool_summary 类型使用正确的固定 prompt', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'bash: 列出了目录内容' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    await callLLMSecondaryCached(mockConfigManager(), 'tool_summary', 'bash ls -la → ...');

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.system[0].text).toContain('tool call summarization');
  });

  it('render 类型使用正确的固定 prompt', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '# Report' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    await callLLMSecondaryCached(mockConfigManager(), 'render', '生成报告');

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.system[0].text).toContain('document rendering');
  });

  it('未知 taskType 降级到 callLLMSecondary', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '降级结果' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    const result = await callLLMSecondaryCached(
      mockConfigManager(),
      'unknown_type' as any,
      '测试消息',
    );
    expect(result).toBe('降级结果');

    // 降级后走普通 callLLMSecondary 路径（system 是纯字符串而非 blocks）
    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    // 降级路径: callLLMSecondary → callAnthropic → system 是字符串
    expect(typeof body.system).toBe('string');
  });

  it('maxTokens 参数正确传递', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '短结果' }] }),
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

    await callLLMSecondaryCached(mockConfigManager(), 'summarize', '内容', { maxTokens: 256 });

    const call = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(call[1]?.body as string);
    expect(body.max_tokens).toBe(256);
  });
});
