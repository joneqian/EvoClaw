import { describe, it, expect, vi, afterEach } from 'vitest';
import { createImageTool, detectMimeType } from '../tools/image-tool.js';

describe('detectMimeType', () => {
  it('应该通过扩展名检测', () => {
    expect(detectMimeType('test.png')).toBe('image/png');
    expect(detectMimeType('test.jpg')).toBe('image/jpeg');
    expect(detectMimeType('test.jpeg')).toBe('image/jpeg');
    expect(detectMimeType('test.gif')).toBe('image/gif');
    expect(detectMimeType('test.webp')).toBe('image/webp');
  });

  it('应该通过 magic bytes 检测 PNG', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
    expect(detectMimeType('unknown', buf)).toBe('image/png');
  });

  it('应该通过 magic bytes 检测 JPEG', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    expect(detectMimeType('unknown', buf)).toBe('image/jpeg');
  });

  it('未知格式应 fallback 为 image/png', () => {
    expect(detectMimeType('unknown.xyz')).toBe('image/png');
  });
});

describe('image 工具', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('应该返回正确的工具定义', () => {
    const tool = createImageTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: '', apiProtocol: 'openai-completions',
    });
    expect(tool.name).toBe('image');
    expect(tool.parameters).toBeDefined();
  });

  it('真正不支持的 provider（非 openai-completions 协议且不在白名单）应返回错误', async () => {
    const tool = createImageTool({
      apiKey: 'key',
      provider: 'cohere',
      modelId: 'command-r',
      baseUrl: '',
      apiProtocol: 'anthropic-messages',
    });
    const result = await tool.execute({ path: 'test.png' });
    expect(result).toContain('不支持图片分析');
    expect(result).toContain('cohere');
  });

  it('openai-completions 协议的国产 provider（qwen/glm/minimax）应通过 supportsVision 放行', async () => {
    // qwen3.6-plus 走 dashscope 的 OpenAI 兼容接口，原生支持 image_url content type
    const tool = createImageTool({
      apiKey: 'key',
      provider: 'qwen',
      modelId: 'qwen3.6-plus',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiProtocol: 'openai-completions',
    });
    // 缺少 path 时返回参数错误，而不是"不支持图片分析"—— 证明 supportsVision 已放行
    const result = await tool.execute({});
    expect(result).not.toContain('不支持图片分析');
    expect(result).toContain('缺少 path');
  });

  it('缺少 path 应返回错误', async () => {
    const tool = createImageTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: '', apiProtocol: 'openai-completions',
    });
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('文件不存在应返回错误', async () => {
    const tool = createImageTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: '', apiProtocol: 'openai-completions',
    });
    const result = await tool.execute({ path: '/nonexistent/image.png' });
    expect(result).toContain('失败');
  });

  it('应该构造正确的 OpenAI 请求', async () => {
    // Mock fetch for image download + API call
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('chat/completions')) {
        return {
          ok: true,
          json: () => Promise.resolve({ choices: [{ message: { content: '这是一张测试图片' } }] }),
        };
      }
      // Image download
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from([0x89, 0x50, 0x4E, 0x47]).buffer),
      };
    });

    const tool = createImageTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: 'https://api.openai.com/v1', apiProtocol: 'openai-completions',
    });
    await tool.execute({ path: 'https://example.com/test.png', prompt: '描述' });

    expect(globalThis.fetch).toHaveBeenCalled();
    // 第二次调用应该是 API 调用
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[1]![0]).toContain('chat/completions');
  });
});
