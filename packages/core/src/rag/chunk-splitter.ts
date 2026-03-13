/**
 * 文档分块器 — 按文件类型智能切分为可索引的块
 *
 * 每块 256-1024 tokens，附带元数据（标题、行号、语言）。
 */

import type { ChunkMetadata } from '@evoclaw/shared';

/** 分块结果 */
export interface Chunk {
  content: string;
  metadata: ChunkMetadata;
  tokenCount: number;
}

/** 分块选项 */
export interface SplitOptions {
  minTokens?: number;  // 默认 256
  maxTokens?: number;  // 默认 1024
}

/** 支持的文档类型 */
export type DocumentType = 'markdown' | 'text' | 'code' | 'pdf';

/** 估算 token 数（中文约 1.5 字符/token，英文约 4 字符/token） */
function estimateTokens(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const nonCjkLength = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.5 + nonCjkLength / 4);
}

/** 按 token 预算分割文本段落 */
function splitByTokenBudget(
  segments: Array<{ text: string; metadata: ChunkMetadata }>,
  minTokens: number,
  maxTokens: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let currentText = '';
  let currentMeta: ChunkMetadata = {};
  let currentTokens = 0;

  for (const seg of segments) {
    const segTokens = estimateTokens(seg.text);

    // 单个段落超过 maxTokens，需要强制分割
    if (segTokens > maxTokens) {
      // 先保存当前累积
      if (currentText) {
        chunks.push({ content: currentText.trim(), metadata: currentMeta, tokenCount: currentTokens });
        currentText = '';
        currentTokens = 0;
      }
      // 按行强制分割大段落
      const lines = seg.text.split('\n');
      let buf = '';
      let bufTokens = 0;
      for (const line of lines) {
        const lineTokens = estimateTokens(line);
        // 单行本身超过 maxTokens，按句子/字符强制切分
        if (lineTokens > maxTokens) {
          if (buf) {
            chunks.push({ content: buf.trim(), metadata: seg.metadata, tokenCount: bufTokens });
            buf = '';
            bufTokens = 0;
          }
          // 按句号/句点切分
          const sentences = line.split(/(?<=[.。!?！？])\s*/);
          for (const sent of sentences) {
            const sentTokens = estimateTokens(sent);
            if (bufTokens + sentTokens > maxTokens && buf) {
              chunks.push({ content: buf.trim(), metadata: seg.metadata, tokenCount: bufTokens });
              buf = '';
              bufTokens = 0;
            }
            buf += sent + ' ';
            bufTokens += sentTokens;
          }
          continue;
        }
        if (bufTokens + lineTokens > maxTokens && buf) {
          chunks.push({ content: buf.trim(), metadata: seg.metadata, tokenCount: bufTokens });
          buf = '';
          bufTokens = 0;
        }
        buf += line + '\n';
        bufTokens += lineTokens;
      }
      if (buf.trim()) {
        currentText = buf;
        currentMeta = seg.metadata;
        currentTokens = bufTokens;
      }
      continue;
    }

    // 累积到 maxTokens 就切
    if (currentTokens + segTokens > maxTokens && currentText) {
      chunks.push({ content: currentText.trim(), metadata: currentMeta, tokenCount: currentTokens });
      currentText = seg.text + '\n';
      currentMeta = seg.metadata;
      currentTokens = segTokens;
    } else {
      if (!currentText) currentMeta = seg.metadata;
      currentText += seg.text + '\n';
      currentTokens += segTokens;
    }
  }

  // 剩余的合并到最后一块或单独成块
  if (currentText.trim()) {
    if (chunks.length > 0 && currentTokens < minTokens) {
      const last = chunks[chunks.length - 1];
      last.content += '\n' + currentText.trim();
      last.tokenCount += currentTokens;
    } else {
      chunks.push({ content: currentText.trim(), metadata: currentMeta, tokenCount: currentTokens });
    }
  }

  return chunks;
}

/** Markdown 分块 — 按 ## 标题切分 */
function splitMarkdown(content: string, minTokens: number, maxTokens: number): Chunk[] {
  const lines = content.split('\n');
  const segments: Array<{ text: string; metadata: ChunkMetadata }> = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);

    if (headingMatch && currentLines.length > 0) {
      segments.push({
        text: currentLines.join('\n'),
        metadata: { heading: currentHeading || undefined, lineStart: startLine, lineEnd: i },
      });
      currentLines = [line];
      currentHeading = headingMatch[1];
      startLine = i + 1;
    } else {
      if (headingMatch) currentHeading = headingMatch[1];
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    segments.push({
      text: currentLines.join('\n'),
      metadata: { heading: currentHeading || undefined, lineStart: startLine, lineEnd: lines.length },
    });
  }

  return splitByTokenBudget(segments, minTokens, maxTokens);
}

/** 纯文本分块 — 按段落（空行）切分 */
function splitText(content: string, minTokens: number, maxTokens: number): Chunk[] {
  const paragraphs = content.split(/\n\s*\n/);
  let lineOffset = 1;
  const segments = paragraphs.map((p) => {
    const lineStart = lineOffset;
    const lineCount = p.split('\n').length;
    lineOffset += lineCount + 1;
    return {
      text: p,
      metadata: { lineStart, lineEnd: lineStart + lineCount - 1 } as ChunkMetadata,
    };
  });

  return splitByTokenBudget(segments, minTokens, maxTokens);
}

/** 代码分块 — 按函数/类声明切分 */
function splitCode(content: string, minTokens: number, maxTokens: number): Chunk[] {
  // 按常见的函数/类声明边界切分
  const pattern = /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|def|fn|pub\s+fn|impl)\s+/m;
  const lines = content.split('\n');
  const segments: Array<{ text: string; metadata: ChunkMetadata }> = [];
  let currentLines: string[] = [];
  let startLine = 1;

  // 尝试检测语言
  const language = detectLanguage(content);

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]) && currentLines.length > 0) {
      segments.push({
        text: currentLines.join('\n'),
        metadata: { lineStart: startLine, lineEnd: i, language },
      });
      currentLines = [lines[i]];
      startLine = i + 1;
    } else {
      currentLines.push(lines[i]);
    }
  }

  if (currentLines.length > 0) {
    segments.push({
      text: currentLines.join('\n'),
      metadata: { lineStart: startLine, lineEnd: lines.length, language },
    });
  }

  return splitByTokenBudget(segments, minTokens, maxTokens);
}

/** 简单语言检测 */
function detectLanguage(content: string): string | undefined {
  if (content.includes('import ') && (content.includes('from ') || content.includes('require('))) return 'typescript';
  if (content.includes('def ') && content.includes(':')) return 'python';
  if (content.includes('fn ') && content.includes('->')) return 'rust';
  if (content.includes('func ') && content.includes('package ')) return 'go';
  return undefined;
}

/**
 * 主入口 — 按文件类型分块文档
 */
export function splitDocument(content: string, type: DocumentType, options?: SplitOptions): Chunk[] {
  const minTokens = options?.minTokens ?? 256;
  const maxTokens = options?.maxTokens ?? 1024;

  if (!content.trim()) return [];

  switch (type) {
    case 'markdown':
      return splitMarkdown(content, minTokens, maxTokens);
    case 'text':
    case 'pdf':
      return splitText(content, minTokens, maxTokens);
    case 'code':
      return splitCode(content, minTokens, maxTokens);
  }
}

/** 根据文件名推断文档类型 */
export function detectDocumentType(fileName: string): DocumentType {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'mdx') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'swift', 'kt'].includes(ext)) return 'code';
  return 'text';
}
