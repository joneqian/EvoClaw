import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebFetchTool, htmlToMarkdown, htmlToMarkdownAsync, type LLMCallFn } from '../tools/web-fetch.js';
import { urlCache } from '../tools/web-cache.js';

describe('htmlToMarkdown 纯函数', () => {
  it('应该转换标题标签', () => {
    expect(htmlToMarkdown('<h1>标题1</h1>')).toContain('# 标题1');
    expect(htmlToMarkdown('<h2>标题2</h2>')).toContain('## 标题2');
    expect(htmlToMarkdown('<h3>标题3</h3>')).toContain('### 标题3');
  });

  it('应该转换链接', () => {
    const result = htmlToMarkdown('<a href="https://example.com">链接文本</a>');
    expect(result).toContain('[链接文本](https://example.com)');
  });

  it('应该转换粗体和斜体', () => {
    expect(htmlToMarkdown('<strong>粗体</strong>')).toContain('**粗体**');
    expect(htmlToMarkdown('<b>粗体</b>')).toContain('**粗体**');
    expect(htmlToMarkdown('<em>斜体</em>')).toContain('*斜体*');
  });

  it('应该转换代码', () => {
    expect(htmlToMarkdown('<code>inline</code>')).toContain('`inline`');
    expect(htmlToMarkdown('<pre><code>block code</code></pre>')).toContain('```\nblock code\n```');
  });

  it('应该转换列表', () => {
    const html = '<ul><li>项目1</li><li>项目2</li></ul>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('- 项目1');
    expect(result).toContain('- 项目2');
  });

  it('应该删除 script/style 标签', () => {
    const html = '<p>内容</p><script>alert("xss")</script><style>.x{}</style>';
    const result = htmlToMarkdown(html);
    expect(result).toContain('内容');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.x');
  });

  it('应该删除 HTML 注释', () => {
    const result = htmlToMarkdown('<!-- 注释 --><p>可见</p>');
    expect(result).toContain('可见');
    expect(result).not.toContain('注释');
  });

  it('应该解码 HTML 实体', () => {
    expect(htmlToMarkdown('&amp; &lt; &gt; &quot;')).toBe('& < > "');
    expect(htmlToMarkdown('&nbsp;')).toBe('');  // 单空格被 trim
    expect(htmlToMarkdown('<p>a&nbsp;b</p>')).toContain('a b');
    expect(htmlToMarkdown('&#65;')).toBe('A');
    expect(htmlToMarkdown('&#x41;')).toBe('A');
  });

  it('应该折叠多余空行', () => {
    const html = '<p>段落1</p>\n\n\n\n<p>段落2</p>';
    const result = htmlToMarkdown(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('应该处理 blockquote', () => {
    const result = htmlToMarkdown('<blockquote>引用内容</blockquote>');
    expect(result).toContain('> 引用内容');
  });

  it('应该处理水平线', () => {
    expect(htmlToMarkdown('<hr />')).toContain('---');
    expect(htmlToMarkdown('<hr>')).toContain('---');
  });

  it('应该删除残留 HTML 标签', () => {
    const result = htmlToMarkdown('<div class="wrapper"><span>文本</span></div>');
    expect(result).toContain('文本');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });
});

// ─── htmlToMarkdownAsync（Turndown）────────────────────────────

describe('htmlToMarkdownAsync（Turndown 主路径）', () => {
  it('应该转换标题', async () => {
    const result = await htmlToMarkdownAsync('<h1>标题</h1>');
    expect(result).toContain('标题');
    // Turndown 输出 # 或 underline 形式
    expect(result).toMatch(/#{1,6}\s*标题|标题\n[=]+/);
  });

  it('应该转换链接', async () => {
    const result = await htmlToMarkdownAsync('<a href="https://example.com">链接</a>');
    expect(result).toContain('[链接](https://example.com)');
  });

  it('应该转换代码块', async () => {
    const result = await htmlToMarkdownAsync('<pre><code>const x = 1;</code></pre>');
    expect(result).toContain('const x = 1;');
  });

  it('应该删除 script 标签', async () => {
    const result = await htmlToMarkdownAsync('<p>内容</p><script>alert("xss")</script>');
    expect(result).toContain('内容');
    expect(result).not.toContain('alert');
  });

  it('应该处理空 HTML', async () => {
    const result = await htmlToMarkdownAsync('');
    expect(result).toBe('');
  });
});

// ─── 工具集成测试 ────────────────────────────────────────────────

/** 创建模拟 Response（兼容 fetchWithSafeRedirects 的 redirect:'manual'） */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  contentLength?: number;
  body?: string;
}): Response {
  const status = opts.status ?? (opts.ok !== false ? 200 : 500);
  const headers = new Headers();
  if (opts.contentType) headers.set('content-type', opts.contentType);
  if (opts.contentLength !== undefined) headers.set('content-length', String(opts.contentLength));

  return {
    ok: opts.ok !== false,
    status,
    statusText: opts.statusText ?? 'OK',
    headers,
    text: () => Promise.resolve(opts.body ?? ''),
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

describe('web_fetch 工具', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    urlCache.clear();
  });

  it('应该返回正确的工具定义', () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe('web_fetch');
    expect(tool.parameters).toBeDefined();
  });

  it('应该抓取并转换 HTML 页面', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        contentType: 'text/html',
        body: '<html><head><title>测试</title></head><body><h1>标题</h1><p>内容</p></body></html>',
      }),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' });
    // Turndown 可能用 # 或 underline 风格
    expect(result).toContain('标题');
    expect(result).toContain('内容');
  });

  it('缺少 url 时应返回错误', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('无效 URL 应返回错误', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'not-a-url' });
    expect(result).toContain('错误');
    expect(result).toContain('无效');
  });

  it('非 http/https 协议应返回错误', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'ftp://example.com' });
    expect(result).toContain('协议');
  });

  // ── 安全增强测试 ──

  it('应该拒绝 localhost URL（SSRF 防护）', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://localhost:3000/admin' });
    expect(result).toContain('错误');
    expect(result).toContain('内部');
  });

  it('应该拒绝私有 IP URL（SSRF 防护）', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'http://192.168.1.1/router' });
    expect(result).toContain('错误');
    expect(result).toContain('私有');
  });

  it('应该拒绝含凭据的 URL', async () => {
    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://user:pass@example.com' });
    expect(result).toContain('错误');
    expect(result).toContain('凭据');
  });

  it('应该自动将 http 升级为 https', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ contentType: 'text/plain', body: 'ok' }),
    );
    globalThis.fetch = fetchMock;

    const tool = createWebFetchTool();
    await tool.execute({ url: 'http://example.com/page' });

    // fetchWithSafeRedirects 内部调用 fetch 时应使用 https
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toMatch(/^https:\/\//);
  });

  it('跨主机重定向时应返回提示信息', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      statusText: 'Found',
      headers: new Headers({ location: 'https://other-domain.com/page' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/redirect' });
    expect(result).toContain('跨域重定向');
    expect(result).toContain('other-domain.com');
  });

  // ── 原有测试 ──

  it('应该处理 HTTP 错误', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ ok: false, status: 404, statusText: 'Not Found' }),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/404' });
    expect(result).toContain('抓取失败');
    expect(result).toContain('404');
  });

  it('应该截断过长内容', async () => {
    const longContent = '<p>' + 'x'.repeat(100) + '</p>';
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ contentType: 'text/html', contentLength: 200, body: longContent }),
    );

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com', maxLength: 50 });
    expect(result).toContain('已截断');
  });

  it('应该处理网络错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result).toContain('ECONNREFUSED');
  });

  // ── 二级模型摘要测试 ──

  it('有 prompt + llmCall 时应调用二级模型摘要', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({
        contentType: 'text/html',
        body: '<h1>API 文档</h1><p>GET /users 返回用户列表</p><p>POST /users 创建用户</p>',
      }),
    );

    const mockLlmCall: LLMCallFn = vi.fn().mockResolvedValue('API 端点：\n- GET /users\n- POST /users');

    const tool = createWebFetchTool({ llmCall: mockLlmCall });
    const result = await tool.execute({
      url: 'https://example.com/api-docs',
      prompt: '提取所有 API 端点',
    });

    expect(mockLlmCall).toHaveBeenCalledOnce();
    expect(result).toContain('GET /users');
    expect(result).toContain('POST /users');
  });

  it('无 llmCall 时即使有 prompt 也应降级到截断模式', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ contentType: 'text/plain', body: '一些内容' }),
    );

    const tool = createWebFetchTool(); // 无 llmCall
    const result = await tool.execute({
      url: 'https://example.com/page',
      prompt: '提取信息',
    });

    // 应直接返回内容（不报错）
    expect(result).toContain('一些内容');
  });

  it('llmCall 失败时应降级到截断模式', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ contentType: 'text/plain', body: '降级内容' }),
    );

    const failingLlmCall: LLMCallFn = vi.fn().mockRejectedValue(new Error('LLM 不可用'));

    const tool = createWebFetchTool({ llmCall: failingLlmCall });
    const result = await tool.execute({
      url: 'https://example.com/page',
      prompt: '提取信息',
    });

    expect(result).toContain('降级内容');
  });

  it('无 prompt 时不应调用 llmCall', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse({ contentType: 'text/plain', body: '普通内容' }),
    );

    const mockLlmCall: LLMCallFn = vi.fn();

    const tool = createWebFetchTool({ llmCall: mockLlmCall });
    const result = await tool.execute({ url: 'https://example.com/page' });

    expect(mockLlmCall).not.toHaveBeenCalled();
    expect(result).toContain('普通内容');
  });
});
