/**
 * Adaptive Read — 根据 context window 自适应调整文件读取大小
 *
 * PI 的 read 工具默认截断到约 50KB，对于大 context window 的模型过于保守。
 * 此模块包装 read 工具，根据模型的 context window 动态调整读取上限，
 * 并在检测到截断时自动分页读取。
 *
 * 工作方式：
 * 1. 根据 contextWindowTokens 计算自适应读取上限
 * 2. 包装 PI read 工具的 execute 函数
 * 3. 检测返回结果中的截断标记，自动追加后续页
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('adaptive-read');

/** 默认最大读取字节数（50KB，与 PI 默认一致） */
const DEFAULT_MAX_BYTES = 50 * 1024;

/** 自适应最大读取上限（512KB，防止单次工具调用占用过多 context） */
const MAX_ADAPTIVE_BYTES = 512 * 1024;

/** context window 中分配给单次读取的比例 */
const CONTEXT_SHARE = 0.2;

/** 平均每 token 的字符数（用于 token→字节估算） */
const CHARS_PER_TOKEN = 4;

/** 最大自动分页次数 */
const MAX_AUTO_PAGES = 8;

/** PI read 工具的截断标记（出现在结果末尾表示文件未读完） */
const TRUNCATION_MARKERS = [
  '[... 内容已截断]',
  '[truncated]',
  '... truncated',
  '[Output truncated',
];

/**
 * 计算自适应读取上限
 * @param contextWindowTokens - 模型的 context window 大小（token 数）
 * @returns 最大读取字节数
 */
export function calculateAdaptiveMaxBytes(contextWindowTokens: number): number {
  const adaptive = contextWindowTokens * CHARS_PER_TOKEN * CONTEXT_SHARE;
  return Math.min(
    Math.max(adaptive, DEFAULT_MAX_BYTES),
    MAX_ADAPTIVE_BYTES,
  );
}

/**
 * 检测结果是否被截断
 */
function isTruncated(resultText: string): boolean {
  const tail = resultText.slice(-200);
  return TRUNCATION_MARKERS.some((marker) => tail.includes(marker));
}

/**
 * 从结果中提取已读行数（用于计算下一页 offset）
 * PI read 工具以 `cat -n` 格式输出，行号在行首
 */
function extractLastLineNumber(resultText: string): number | null {
  // 从末尾向前搜索最后一个行号
  const lines = resultText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(/^\s*(\d+)[→\t]/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * 包装 PI read 工具，添加自适应分页能力
 *
 * @param originalTool - PI 原始 read 工具对象（含 execute、parameters 等）
 * @param contextWindowTokens - 模型的 context window 大小
 * @returns 包装后的工具对象
 */
export function createAdaptiveReadTool(originalTool: any, contextWindowTokens: number): any {
  const adaptiveMaxBytes = calculateAdaptiveMaxBytes(contextWindowTokens);
  const adaptiveMaxLines = Math.floor(adaptiveMaxBytes / 80); // 假设平均行长 80 字符

  log.info(
    `Adaptive Read: contextWindow=${contextWindowTokens}, ` +
    `adaptiveMaxBytes=${adaptiveMaxBytes}, adaptiveMaxLines=${adaptiveMaxLines}`,
  );

  const originalExecute = originalTool.execute;

  return {
    ...originalTool,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => {
      const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;

      // 如果用户未指定 limit，注入自适应的 limit
      if (!args.limit && !args.offset) {
        args.limit = adaptiveMaxLines;
      }

      // 调用原始 read
      const result = await originalExecute(toolCallId, args, signal, onUpdate);
      const resultText = result?.content?.[0]?.text ?? '';

      // 检测截断，自动追加后续页
      if (isTruncated(resultText) && !args.offset) {
        let fullText = resultText;
        let currentOffset = extractLastLineNumber(resultText);
        let pageCount = 1;

        while (currentOffset && pageCount < MAX_AUTO_PAGES) {
          log.debug(`Adaptive Read 自动分页: page=${pageCount + 1}, offset=${currentOffset}`);

          const nextArgs = { ...args, offset: currentOffset + 1, limit: adaptiveMaxLines };
          try {
            const nextResult = await originalExecute(toolCallId, nextArgs, signal, onUpdate);
            const nextText = nextResult?.content?.[0]?.text ?? '';

            if (!nextText || nextText.trim() === '') break;

            fullText += '\n' + nextText;
            pageCount++;

            if (!isTruncated(nextText)) break;

            const nextLastLine = extractLastLineNumber(nextText);
            if (!nextLastLine || nextLastLine <= currentOffset) break;
            currentOffset = nextLastLine;
          } catch {
            log.warn('Adaptive Read 自动分页失败，返回已读内容');
            break;
          }
        }

        if (pageCount > 1) {
          log.info(`Adaptive Read: 自动读取 ${pageCount} 页`);
        }

        return {
          ...result,
          content: [{ type: 'text', text: fullText }],
        };
      }

      return result;
    },
  };
}
