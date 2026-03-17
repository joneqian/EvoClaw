/**
 * PDF 阅读工具 — 双模式
 * 原生模式: Anthropic/Google 直发 PDF 字节（绕过 PI）
 * 提取模式: unpdf 提取文本（其他 provider）
 * 参考 OpenClaw pdf-native-providers.ts + pdf-tool.ts
 */

import fs from 'node:fs';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { ProviderConfig } from './provider-direct.js';
import { NATIVE_PDF_PROVIDERS, callAnthropic, callGoogle } from './provider-direct.js';

/** 最大 PDF 大小 10MB */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** 最大页数 */
const MAX_PAGES = 20;
/** 提取文本最大长度 */
const MAX_TEXT_LENGTH = 50_000;
/** fetch 超时 */
const FETCH_TIMEOUT_MS = 15_000;

/** 创建 pdf 工具 */
export function createPdfTool(config: ProviderConfig): ToolDefinition {
  return {
    name: 'pdf',
    description: '阅读和分析 PDF 文档。支持本地文件路径或 HTTP/HTTPS URL。可以总结文档、提取信息、回答关于文档内容的问题。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'PDF 文件的本地路径或 URL' },
        prompt: { type: 'string', description: '分析指令（默认：总结这份文档的主要内容）' },
        pages: { type: 'string', description: '页码范围，如 "1-5" 或 "1,3,5"（默认全部，最大 20 页）' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const pdfPath = args['path'] as string;
      const prompt = (args['prompt'] as string) || '总结这份文档的主要内容';
      const pagesStr = args['pages'] as string | undefined;

      if (!pdfPath) return '错误：缺少 path 参数';

      try {
        // 读取 PDF 字节
        const buffer = await loadPdf(pdfPath);

        // 路由到原生模式或提取模式
        if (NATIVE_PDF_PROVIDERS.has(config.provider)) {
          return await nativeMode(config, buffer, prompt);
        } else {
          return await extractMode(buffer, prompt, pagesStr);
        }
      } catch (err) {
        return `PDF 处理失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** 加载 PDF 为 Buffer */
async function loadPdf(pdfPath: string): Promise<Buffer> {
  let buffer: Buffer;

  if (pdfPath.startsWith('http://') || pdfPath.startsWith('https://')) {
    const response = await fetch(pdfPath, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`下载 PDF 失败: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`文件不存在: ${pdfPath}`);
    }
    buffer = fs.readFileSync(pdfPath);
  }

  if (buffer.length > MAX_PDF_BYTES) {
    throw new Error(`PDF 过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），最大 ${MAX_PDF_BYTES / 1024 / 1024}MB`);
  }

  return buffer;
}

/**
 * 原生模式 — 直接发 PDF 字节给 Anthropic/Google
 */
async function nativeMode(config: ProviderConfig, buffer: Buffer, prompt: string): Promise<string> {
  const base64 = buffer.toString('base64');

  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(
        config,
        [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt },
        ],
        ['pdfs-2024-09-25'],  // Anthropic PDF beta header
      );

    case 'google':
      return callGoogle(config, [
        { inline_data: { mime_type: 'application/pdf', data: base64 } },
        { text: prompt },
      ]);

    default:
      throw new Error(`原生 PDF 不支持 provider: ${config.provider}`);
  }
}

/**
 * 提取模式 — unpdf 提取文本
 */
async function extractMode(buffer: Buffer, prompt: string, pagesStr?: string): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const totalPages = pdf.numPages;

    // 解析页码范围
    const pageRange = parsePageRange(pagesStr, totalPages);
    if (pageRange.length > MAX_PAGES) {
      return `错误：请求页数（${pageRange.length}）超过最大限制（${MAX_PAGES} 页）。请缩小页码范围。`;
    }

    // 提取指定页码的文本
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];

    const selectedPages = pageRange
      .filter(p => p <= pages.length)
      .map(p => `--- 第 ${p} 页 ---\n${pages[p - 1]}`)
      .join('\n\n');

    let result = selectedPages || '（未提取到文本内容）';

    // 截断
    if (result.length > MAX_TEXT_LENGTH) {
      result = result.slice(0, MAX_TEXT_LENGTH) + `\n\n...[文本已截断，共 ${result.length} 字符]`;
    }

    return `PDF 文档（共 ${totalPages} 页，已提取 ${pageRange.length} 页）：\n\n${result}\n\n---\n用户指令: ${prompt}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Cannot find module') || message.includes('Cannot find package')) {
      return '错误：PDF 文本提取需要安装 unpdf 依赖。请运行: pnpm add unpdf';
    }
    throw err;
  }
}

/**
 * 解析页码范围字符串
 * 支持: "1-5", "1,3,5", "1-3,7,9-10", undefined(全部)
 */
export function parsePageRange(pagesStr: string | undefined, totalPages: number): number[] {
  if (!pagesStr) {
    // 默认全部页，但不超过 MAX_PAGES
    const count = Math.min(totalPages, MAX_PAGES);
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  const parts = pagesStr.split(',').map(s => s.trim());

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Math.max(1, Number(rangeMatch[1]));
      const end = Math.min(totalPages, Number(rangeMatch[2]));
      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      const num = Number(part);
      if (num >= 1 && num <= totalPages) pages.add(num);
    }
  }

  return [...pages].sort((a, b) => a - b);
}
