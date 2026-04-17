/**
 * Web 抓取工具 — URL → Markdown 转换
 *
 * 安全特性（参考 Claude Code）：
 * - URL 校验（协议、格式、凭据、内部域名、私有 IP）
 * - HTTP → HTTPS 自动升级
 * - 安全重定向（同主机跟随，跨主机返回 LLM）
 * - 响应体大小限制
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import {
  validateWebURLAsync,
  upgradeToHttps,
  fetchWithSafeRedirects,
} from '../security/web-security.js';
import { urlCache } from './web-cache.js';

/** 最大响应体大小 2MB */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** 默认输出字符上限 */
const DEFAULT_MAX_LENGTH = 50_000;
/** 二级摘要 Markdown 截断阈值（超过此长度先截断再送 LLM） */
const MAX_MARKDOWN_FOR_SUMMARY = 100_000;
/** 请求超时 30 秒（升级自 15s，对齐 Claude Code 60s 但保守些） */
const FETCH_TIMEOUT_MS = 30_000;

/** LLM 调用函数签名（依赖注入，解耦模型选择） */
export type LLMCallFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface WebFetchToolOptions {
  /**
   * 二级模型调用函数（可选）
   * 当 Agent 提供 prompt 参数时，用此函数从页面内容中提取信息
   * 不提供时退化为截断模式
   */
  readonly llmCall?: LLMCallFn;
}

/** 创建 web_fetch 工具 */
export function createWebFetchTool(opts: WebFetchToolOptions = {}): ToolDefinition {
  const { llmCall } = opts;
  return {
    name: 'web_fetch',
    description: '抓取指定 URL 的网页内容并返回。可提供 prompt 参数指定需要提取的信息，系统会用小型模型从页面中精准提取，大幅减少返回内容量。注意：无法访问需要登录认证的页面。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页 URL' },
        prompt: { type: 'string', description: '指定需要从页面中提取的信息（如"提取所有 API 端点"），系统会用小型模型做摘要。不提供则返回完整内容。' },
        maxLength: { type: 'number', description: '输出最大字符数（默认 50000）' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      const rawUrl = args['url'] as string;
      const prompt = args['prompt'] as string | undefined;
      const maxLength = (args['maxLength'] as number) ?? DEFAULT_MAX_LENGTH;

      if (!rawUrl) return '错误：缺少 url 参数';

      // ── 1. URL 安全校验（含 DNS 解析后的 IP 复检，防 DNS rebinding） ──
      const validation = await validateWebURLAsync(rawUrl);
      if (!validation.ok) {
        return `错误：${validation.reason}`;
      }

      // ── 2. HTTP → HTTPS 升级 ──
      const url = upgradeToHttps(rawUrl);

      // ── 3. 缓存查询 ──
      const cached = urlCache.get(url);
      if (cached !== undefined) {
        let result = cached;
        if (result.length > maxLength) {
          result = result.slice(0, maxLength) +
            `\n\n...[内容已截断，共 ${result.length} 字符，显示前 ${maxLength} 字符]`;
        }
        return result || '（页面内容为空）';
      }

      try {
        // ── 4. 安全重定向请求 ──
        const fetchResult = await fetchWithSafeRedirects(url, {
          headers: {
            'User-Agent': 'EvoClaw/1.0 (Web Fetch Tool)',
            'Accept': 'text/markdown, text/html, application/xhtml+xml, text/plain, */*',
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        // 跨主机重定向 → 返回信息让 LLM 决定
        if (fetchResult.redirect) {
          return `页面发生了跨域重定向：\n` +
            `原始 URL: ${fetchResult.redirect.originalUrl}\n` +
            `重定向到: ${fetchResult.redirect.redirectUrl}\n` +
            `如需继续访问，请使用新 URL 重新调用 web_fetch。`;
        }

        // 请求错误
        if (fetchResult.error) {
          return `抓取失败: ${fetchResult.error}`;
        }

        const response = fetchResult.response!;

        if (!response.ok) {
          return `抓取失败: HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const contentLength = Number(response.headers.get('content-length') ?? '0');

        // ── 5. 响应体大小检查 ──
        if (contentLength > MAX_RESPONSE_BYTES) {
          return `错误：响应体过大（${(contentLength / 1024 / 1024).toFixed(1)}MB），超过 2MB 限制。`;
        }

        const text = await response.text();

        if (text.length > MAX_RESPONSE_BYTES) {
          return `错误：响应体过大（${(text.length / 1024 / 1024).toFixed(1)}MB），超过 2MB 限制。`;
        }

        // ── 6. 内容处理 ──
        let markdown: string;
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          markdown = await htmlToMarkdownAsync(text);
        } else {
          markdown = text;
        }

        // ── 7. 写入缓存（截断前的完整内容） ──
        const byteSize = new TextEncoder().encode(markdown).length;
        urlCache.set(url, markdown, byteSize);

        // ── 8. 二级模型摘要（可选） ──
        if (prompt && llmCall && markdown.length > 0) {
          try {
            const contentForSummary = markdown.length > MAX_MARKDOWN_FOR_SUMMARY
              ? markdown.slice(0, MAX_MARKDOWN_FOR_SUMMARY) + '\n\n[内容已截断...]'
              : markdown;
            const summary = await applyPromptToContent(llmCall, contentForSummary, prompt);
            return summary || '（未能从页面中提取到相关信息）';
          } catch {
            // 摘要失败 → 降级到截断模式
          }
        }

        // ── 9. 截断（无 prompt 或摘要失败时的降级路径） ──
        if (markdown.length > maxLength) {
          markdown = markdown.slice(0, maxLength) +
            `\n\n...[内容已截断，共 ${markdown.length} 字符，显示前 ${maxLength} 字符]`;
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

// ── Turndown 延迟加载单例（参考 Claude Code） ──

type TurndownInstance = { turndown(html: string): string };
let turndownPromise: Promise<TurndownInstance> | undefined;

function getTurndownService(): Promise<TurndownInstance> {
  return (turndownPromise ??= import('turndown').then((m) => {
    const Turndown = (m as unknown as {
      default: new (opts?: { headingStyle?: string }) => TurndownInstance & {
        remove(filter: string | string[]): void;
      };
    }).default;
    const td = new Turndown({ headingStyle: 'atx' }); // 使用 # 风格标题
    // 移除 script/style/noscript 标签
    td.remove(['script', 'style', 'noscript']);
    return td;
  }));
}

/**
 * HTML → Markdown 转换
 * 主路径：Turndown（成熟 DOM 解析）
 * 降级路径：纯 regex（Turndown 加载失败时）
 */
export async function htmlToMarkdownAsync(html: string): Promise<string> {
  try {
    const td = await getTurndownService();
    return cleanMarkdown(td.turndown(html));
  } catch {
    return htmlToMarkdownRegex(html);
  }
}

/**
 * HTML → Markdown 同步版（纯 regex，用于测试和降级）
 * 保持向后兼容
 */
export function htmlToMarkdown(html: string): string {
  return htmlToMarkdownRegex(html);
}

/** 清理 Turndown 输出的多余空白 */
function cleanMarkdown(text: string): string {
  let result = text;
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();
  return result;
}

/** 纯 regex HTML → Markdown（降级路径） */
function htmlToMarkdownRegex(html: string): string {
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

// ── 二级模型摘要 ─────────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `你是一个网页内容分析助手。用户会提供一段网页内容和一个提取指令。
请根据指令从内容中提取相关信息，返回简洁、结构化的结果。

规则：
- 只返回与指令相关的信息，忽略无关内容
- 使用 Markdown 格式组织输出
- 引用原文时用引号标注，单段引用不超过 125 字符
- 如果内容中找不到相关信息，明确说明
- 保持简洁，不要添加与原文无关的内容`;

/**
 * 用二级模型从页面内容中提取信息
 * 参考 Claude Code 的 applyPromptToMarkdown 模式
 */
async function applyPromptToContent(
  llmCall: LLMCallFn,
  content: string,
  prompt: string,
): Promise<string> {
  const userMessage = `以下是网页内容：

---
${content}
---

请根据以下指令提取信息：
${prompt}`;

  return llmCall(SUMMARY_SYSTEM_PROMPT, userMessage);
}
