/**
 * Web 抓取工具 — URL → Markdown 转换
 * 纯 regex 实现，不依赖外部库
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';

/** 最大响应体大小 2MB */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** 默认输出字符上限 */
const DEFAULT_MAX_LENGTH = 50_000;
/** 请求超时 15 秒 */
const FETCH_TIMEOUT_MS = 15_000;

/** 创建 web_fetch 工具 */
export function createWebFetchTool(): ToolDefinition {
  return {
    name: 'web_fetch',
    description: '抓取指定 URL 的网页内容，转换为 Markdown 格式返回。适用于阅读文章、文档、博客等网页内容。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页 URL' },
        maxLength: { type: 'number', description: '输出最大字符数（默认 50000）' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      const url = args['url'] as string;
      const maxLength = (args['maxLength'] as number) ?? DEFAULT_MAX_LENGTH;

      if (!url) return '错误：缺少 url 参数';

      // 基本 URL 校验
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return `错误：无效的 URL "${url}"`;
      }

      // 仅允许 http/https
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return `错误：仅支持 http/https 协议，收到 "${parsedUrl.protocol}"`;
      }

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'EvoClaw/1.0 (Web Fetch Tool)',
            'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          return `抓取失败: HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const contentLength = Number(response.headers.get('content-length') ?? '0');

        // 检查响应体大小
        if (contentLength > MAX_RESPONSE_BYTES) {
          return `错误：响应体过大（${(contentLength / 1024 / 1024).toFixed(1)}MB），超过 2MB 限制。`;
        }

        const text = await response.text();

        // 二次检查实际大小
        if (text.length > MAX_RESPONSE_BYTES) {
          return `错误：响应体过大（${(text.length / 1024 / 1024).toFixed(1)}MB），超过 2MB 限制。`;
        }

        // 根据内容类型决定处理方式
        let markdown: string;
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          markdown = htmlToMarkdown(text);
        } else {
          // 纯文本或其他格式，直接返回
          markdown = text;
        }

        // 截断
        if (markdown.length > maxLength) {
          markdown = markdown.slice(0, maxLength) + `\n\n...[内容已截断，共 ${markdown.length} 字符，显示前 ${maxLength} 字符]`;
        }

        return markdown || '（页面内容为空）';
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          return `抓取超时（${FETCH_TIMEOUT_MS / 1000} 秒），请稍后重试。`;
        }
        return `抓取出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * HTML → Markdown 转换（纯 regex 实现）
 * 参考 OpenClaw web-fetch-utils.ts
 */
export function htmlToMarkdown(html: string): string {
  let text = html;

  // 删除 script/style/noscript 标签及其内容
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // 删除 HTML 注释
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // 删除 head 标签内容
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');

  // 标题 h1-h6
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // 代码块 pre > code
  text = text.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // 内联代码
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 链接
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 图片
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // 粗体/斜体
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // 列表项
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');

  // 段落和换行
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  text = text.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '\n$1\n');
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // 水平线
  text = text.replace(/<hr[^>]*\/?>/gi, '\n---\n');

  // 表格简化处理
  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '$1\n');
  text = text.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, '| $1 ');

  // 删除所有剩余 HTML 标签
  text = text.replace(/<[^>]+>/g, '');

  // HTML 实体解码
  text = decodeHtmlEntities(text);

  // 清理多余空白
  text = text.replace(/\n{3,}/g, '\n\n');  // 多空行折叠
  text = text.replace(/[ \t]+/g, ' ');      // 多空格折叠
  text = text.replace(/^ +/gm, '');          // 行首空格
  text = text.trim();

  return text;
}

/** HTML 实体解码 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&laquo;': '«',
    '&raquo;': '»',
    '&bull;': '•',
    '&middot;': '·',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replaceAll(entity, char);
  }

  // 数字实体 &#123; / &#x1F600;
  result = result.replace(/&#(\d+);/g, (_, code) =>
    String.fromCodePoint(Number(code))
  );
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCodePoint(Number.parseInt(hex, 16))
  );

  return result;
}
