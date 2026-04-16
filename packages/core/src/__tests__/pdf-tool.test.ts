import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPdfTool, parsePageRange } from '../tools/pdf-tool.js';

describe('parsePageRange', () => {
  it('无参数应返回全部页（不超过 20）', () => {
    expect(parsePageRange(undefined, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePageRange(undefined, 30)).toHaveLength(20);
  });

  it('应该解析单页', () => {
    expect(parsePageRange('3', 10)).toEqual([3]);
  });

  it('应该解析范围', () => {
    expect(parsePageRange('2-5', 10)).toEqual([2, 3, 4, 5]);
  });

  it('应该解析混合格式', () => {
    expect(parsePageRange('1-3,7,9-10', 15)).toEqual([1, 2, 3, 7, 9, 10]);
  });

  it('应该去重并排序', () => {
    expect(parsePageRange('3,1,3,2', 10)).toEqual([1, 2, 3]);
  });

  it('应该限制在 totalPages 范围内', () => {
    expect(parsePageRange('1-100', 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('超出范围的页码应被忽略', () => {
    expect(parsePageRange('50', 10)).toEqual([]);
  });
});

describe('pdf 工具', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('应该返回正确的工具定义', () => {
    const tool = createPdfTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: '',
    });
    expect(tool.name).toBe('pdf');
    expect(tool.parameters).toBeDefined();
  });

  it('缺少 path 应返回错误', async () => {
    const tool = createPdfTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: '',
    });
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('文件不存在应返回错误', async () => {
    const tool = createPdfTool({
      apiKey: 'key', provider: 'openai', modelId: 'gpt-4o', baseUrl: '',
    });
    const result = await tool.execute({ path: '/nonexistent/file.pdf' });
    expect(result).toContain('失败');
  });

  it('Anthropic 原生模式应包含 beta header', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      if (opts?.method === 'POST') {
        return {
          ok: true,
          json: () => Promise.resolve({ content: [{ type: 'text', text: '文档分析结果' }] }),
        };
      }
      // PDF download
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('%PDF-1.4 test').buffer),
      };
    });

    const tool = createPdfTool({
      apiKey: 'key', provider: 'anthropic', modelId: 'claude-sonnet-4-20250514', baseUrl: '',
    });
    await tool.execute({ path: 'https://example.com/test.pdf' });

    // 验证 beta header
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const apiCall = calls.find(c => (c[1] as RequestInit)?.method === 'POST');
    expect(apiCall).toBeDefined();
    const headers = (apiCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers['anthropic-beta']).toContain('pdfs-2024-09-25');
  });

  it('Google 原生模式应使用 inline_data', async () => {
    let capturedBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
      if (typeof url === 'string' && url.includes('generateContent')) {
        capturedBody = JSON.parse(opts?.body as string);
        return {
          ok: true,
          json: () => Promise.resolve({
            candidates: [{ content: { parts: [{ text: 'PDF 分析' }] } }],
          }),
        };
      }
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('%PDF-1.4 test').buffer),
      };
    });

    const tool = createPdfTool({
      apiKey: 'key', provider: 'google', modelId: 'gemini-pro', baseUrl: '',
    });
    await tool.execute({ path: 'https://example.com/test.pdf' });

    expect(capturedBody?.contents?.[0]?.parts).toBeDefined();
    const parts = capturedBody.contents[0].parts;
    const inlineData = parts.find((p: any) => p.inline_data);
    expect(inlineData?.inline_data?.mime_type).toBe('application/pdf');
  });
});
