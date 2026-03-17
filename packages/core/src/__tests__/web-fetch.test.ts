import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { htmlToMarkdown } from '../tools/web-fetch.js';

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
    // 多空格会被折叠为单空格
    expect(htmlToMarkdown('&amp; &lt; &gt; &quot;')).toBe('& < > "');
    expect(htmlToMarkdown('&nbsp;')).toBe('');  // 单空格被 trim
    expect(htmlToMarkdown('<p>a&nbsp;b</p>')).toContain('a b');
    expect(htmlToMarkdown('&#65;')).toBe('A');
    expect(htmlToMarkdown('&#x41;')).toBe('A');
  });

  it('应该折叠多余空行', () => {
    const html = '<p>段落1</p>\n\n\n\n<p>段落2</p>';
    const result = htmlToMarkdown(html);
    // 不应有 3 个以上连续空行
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

describe('web_fetch 工具', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('应该返回正确的工具定义', () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe('web_fetch');
    expect(tool.parameters).toBeDefined();
  });

  it('应该抓取并转换 HTML 页面', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/html']]) as any,
      text: () => Promise.resolve('<html><head><title>测试</title></head><body><h1>标题</h1><p>内容</p></body></html>'),
    });

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result).toContain('# 标题');
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
    expect(result).toContain('仅支持 http/https');
  });

  it('应该处理 HTTP 错误', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com/404' });
    expect(result).toContain('抓取失败');
    expect(result).toContain('404');
  });

  it('应该截断过长内容', async () => {
    const longContent = '<p>' + 'x'.repeat(100) + '</p>';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Map([['content-type', 'text/html'], ['content-length', '200']]) as any,
      text: () => Promise.resolve(longContent),
    });

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com', maxLength: 50 });
    expect(result).toContain('已截断');
  });

  it('应该处理网络错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const tool = createWebFetchTool();
    const result = await tool.execute({ url: 'https://example.com' });
    expect(result).toContain('抓取出错');
    expect(result).toContain('ECONNREFUSED');
  });
});
