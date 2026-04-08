/**
 * SOP 文档解析器
 *
 * 将上传的 docx / md / xlsx 文档统一解析为纯文本，
 * 供 SOP Designer Agent 阅读分析。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 支持的文档扩展名 */
export const SUPPORTED_EXTENSIONS = ['md', 'docx', 'xlsx'] as const;
export type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

/** 单文档最大解析后字符数（防上下文炸裂） */
export const MAX_PARSED_CHARS = 200_000;

/**
 * 从文件名/路径推断扩展名（小写）
 * .markdown 归一为 md
 */
export function inferExtension(filePath: string): SupportedExt | null {
  const raw = path.extname(filePath).toLowerCase().replace(/^\./, '');
  if (raw === 'markdown') return 'md';
  if ((SUPPORTED_EXTENSIONS as readonly string[]).includes(raw)) {
    return raw as SupportedExt;
  }
  return null;
}

/**
 * 解析文档为纯文本
 *
 * @throws 文件不存在时抛错
 * @throws 不支持的扩展名时抛错
 */
export async function parseDocToText(
  filePath: string,
  ext: SupportedExt,
): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  let text: string;
  switch (ext) {
    case 'md':
      text = parseMarkdown(filePath);
      break;
    case 'docx':
      text = await parseDocx(filePath);
      break;
    case 'xlsx':
      text = await parseXlsx(filePath);
      break;
    default:
      throw new Error(`不支持的文档类型: ${ext}`);
  }

  if (text.length > MAX_PARSED_CHARS) {
    return text.slice(0, MAX_PARSED_CHARS) + `\n\n...[文本已截断，原始长度 ${text.length} 字符]`;
  }
  return text;
}

/** 解析 Markdown — 直接返回原内容 */
function parseMarkdown(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/** 解析 DOCX — 使用 mammoth 提取纯文本 */
async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.trim();
}

/** 解析 XLSX — 使用 sheet_to_csv 拉平所有 sheet */
async function parseXlsx(filePath: string): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`# ${sheetName}\n\n${csv}`);
  }
  return parts.join('\n\n').trim();
}
