import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWebSearchTool } from '../tools/web-search.js';

describe('web_search 工具', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('应该返回正确的工具定义', () => {
    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    expect(tool.name).toBe('web_search');
    expect(tool.description).toContain('搜索');
    expect(tool.parameters).toBeDefined();
  });

  it('应该正确调用 Brave API 并格式化结果', async () => {
    const mockResponse = {
      web: {
        results: [
          { title: '测试标题1', url: 'https://example.com/1', description: '测试摘要1' },
          { title: '测试标题2', url: 'https://example.com/2', description: '测试摘要2' },
        ],
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    const result = await tool.execute({ query: 'test query', count: 2 });

    // 验证 fetch 调用
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.search.brave.com');
    expect(url).toContain('q=test+query');
    expect(url).toContain('count=2');
    expect((opts.headers as Record<string, string>)['X-Subscription-Token']).toBe('test-key');

    // 验证输出格式
    expect(result).toContain('测试标题1');
    expect(result).toContain('https://example.com/1');
    expect(result).toContain('测试摘要1');
    expect(result).toContain('共 2 条');
  });

  it('应该处理空结果', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web: { results: [] } }),
    });

    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    const result = await tool.execute({ query: '不存在的内容' });
    expect(result).toContain('未找到');
  });

  it('应该处理 API 错误', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('Invalid API key'),
    });

    const tool = createWebSearchTool({ braveApiKey: 'bad-key' });
    const result = await tool.execute({ query: 'test' });
    expect(result).toContain('搜索失败');
    expect(result).toContain('401');
  });

  it('缺少 query 时应返回错误', async () => {
    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('count 应该限制在 20 以内', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web: { results: [] } }),
    });

    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    await tool.execute({ query: 'test', count: 100 });

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('count=20');
  });

  it('应该支持 freshness 参数', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ web: { results: [] } }),
    });

    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    await tool.execute({ query: 'test', freshness: 'pd' });

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('freshness=pd');
  });

  it('应该处理网络错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const tool = createWebSearchTool({ braveApiKey: 'test-key' });
    const result = await tool.execute({ query: 'test' });
    expect(result).toContain('搜索出错');
    expect(result).toContain('Network error');
  });
});
