/**
 * browser 工具 — 浏览器自动化
 *
 * 基础模式: fetch + HTML 文本提取（无外部依赖）
 * 完整模式: Playwright（可选依赖，需 pnpm add -D playwright）
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';

/** fetch 超时 15s */
const FETCH_TIMEOUT_MS = 15_000;

/** 创建 browser 工具 */
export function createBrowserTool(): ToolDefinition {
  return {
    name: 'browser',
    description: '浏览器自动化：导航网页、点击元素、输入文本、截图。基础模式使用 HTTP 抓取，完整模式需安装 Playwright。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['navigate', 'screenshot', 'click', 'type', 'extract', 'evaluate'],
          description: '操作类型',
        },
        url: { type: 'string', description: '目标 URL（navigate 时必填）' },
        selector: { type: 'string', description: 'CSS 选择器（click/type/extract 时使用）' },
        text: { type: 'string', description: '输入文本（type 时使用）' },
        script: { type: 'string', description: 'JavaScript 代码（evaluate 时使用）' },
      },
      required: ['action'],
    },
    execute: async (args) => {
      const action = args['action'] as string;
      const url = args['url'] as string | undefined;

      try {
        // 尝试加载 Playwright（可选依赖）
        const pw = await import('playwright').catch(() => null);

        if (pw) {
          return await executeWithPlaywright(pw, action, args);
        }

        // Fallback: 基础 HTTP 模式
        if (action === 'navigate' && url) {
          return await fetchBasicMode(url);
        }

        return '完整浏览器功能需要安装 Playwright: pnpm add -D playwright\n当前基础模式仅支持 navigate 操作。';
      } catch (err) {
        return `浏览器操作失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** 基础 HTTP 模式 — fetch + HTML 文本提取 */
async function fetchBasicMode(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 EvoClaw/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    return `抓取失败: HTTP ${response.status} ${response.statusText}`;
  }

  const html = await response.text();
  // 简单提取文本内容
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10_000);

  return `[基础模式] 页面内容 (${url}):\n${text}`;
}

/** Playwright 完整模式 */
async function executeWithPlaywright(
  pw: typeof import('playwright'),
  action: string,
  args: Record<string, unknown>,
): Promise<string> {
  const browser = await pw.chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    switch (action) {
      case 'navigate': {
        const url = args['url'] as string | undefined;
        if (!url) return '错误：navigate 需要 url 参数';
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
        const title = await page.title();
        const bodyText = await page.textContent('body');
        return `页面: ${title}\n内容: ${(bodyText ?? '').slice(0, 10_000)}`;
      }

      case 'screenshot': {
        const url = args['url'] as string | undefined;
        if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: FETCH_TIMEOUT_MS });
        const buffer = await page.screenshot({ type: 'png' });
        const outputPath = `/tmp/evoclaw-screenshot-${Date.now()}.png`;
        const fs = await import('node:fs');
        fs.writeFileSync(outputPath, buffer);
        return `截图已保存: ${outputPath}`;
      }

      case 'click': {
        const selector = args['selector'] as string | undefined;
        if (!selector) return '错误：click 需要 selector 参数';
        await page.click(selector);
        return `已点击: ${selector}`;
      }

      case 'type': {
        const selector = args['selector'] as string | undefined;
        const text = args['text'] as string | undefined;
        if (!selector || !text) return '错误：type 需要 selector 和 text 参数';
        await page.fill(selector, text);
        return `已输入: ${text} → ${selector}`;
      }

      case 'extract': {
        const selector = (args['selector'] as string | undefined) ?? 'body';
        const text = await page.textContent(selector);
        return (text ?? '').slice(0, 10_000);
      }

      case 'evaluate': {
        const script = args['script'] as string | undefined;
        if (!script) return '错误：evaluate 需要 script 参数';
        const result = await page.evaluate(script);
        return JSON.stringify(result, null, 2);
      }

      default:
        return `未知操作: ${action}`;
    }
  } finally {
    await browser.close();
  }
}
