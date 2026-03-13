/**
 * 文本清洗器 — 防止记忆提取时产生反馈循环
 *
 * 当 LLM 生成的文本引用了之前注入的记忆/RAG 上下文时，
 * 需要在提取新记忆前剥离这些标记内容，避免循环引用。
 */

/** 零宽空格标记，用于标识注入的上下文边界 */
export const MARKERS = {
  EVOCLAW_MEM_START: '\u200B\u200C\u200B__EVOCLAW_MEM_START__\u200B\u200C\u200B',
  EVOCLAW_MEM_END: '\u200B\u200C\u200B__EVOCLAW_MEM_END__\u200B\u200C\u200B',
  EVOCLAW_RAG_START: '\u200B\u200C\u200B__EVOCLAW_RAG_START__\u200B\u200C\u200B',
  EVOCLAW_RAG_END: '\u200B\u200C\u200B__EVOCLAW_RAG_END__\u200B\u200C\u200B',
} as const;

/** 最大输出长度 */
const MAX_LENGTH = 24_000;

/** CJK 最小字符数 */
const MIN_CJK_LENGTH = 4;

/** 非 CJK 最小字符数 */
const MIN_NON_CJK_LENGTH = 10;

/**
 * 检测文本是否包含 CJK 字符（中日韩统一表意文字）
 */
export function containsCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF]/.test(text);
}

/**
 * 转义字符串中的正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 剥离指定标记对之间的内容（支持嵌套）
 */
function stripMarkedContent(text: string, startMarker: string, endMarker: string): string {
  const escapedStart = escapeRegex(startMarker);
  const escapedEnd = escapeRegex(endMarker);
  // 非贪婪匹配，从最内层开始逐层剥离嵌套
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'g');

  let result = text;
  let prev = '';
  // 循环处理嵌套标记
  while (result !== prev) {
    prev = result;
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * 对文本进行清洗，剥离注入的上下文，准备用于记忆提取
 *
 * @returns 清洗后的文本，若内容太短则返回 null
 */
export function sanitizeForExtraction(text: string): string | null {
  let result = text;

  // 1. 剥离注入的记忆上下文
  result = stripMarkedContent(result, MARKERS.EVOCLAW_MEM_START, MARKERS.EVOCLAW_MEM_END);

  // 2. 剥离注入的 RAG 上下文
  result = stripMarkedContent(result, MARKERS.EVOCLAW_RAG_START, MARKERS.EVOCLAW_RAG_END);

  // 3. 剥离元数据 JSON 块
  result = result.replace(/\n\{[\s\S]*?"_evoclaw_meta"[\s\S]*?\}\n/g, '\n');

  // 4. 过滤命令消息（以 / 开头的行）
  result = result
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('/'))
    .join('\n');

  // 5. 去除首尾空白，合并连续空行（最多保留 2 个换行）
  result = result.trim().replace(/\n{3,}/g, '\n\n');

  // 6. CJK 感知的最小长度检查
  const minLength = containsCJK(result) ? MIN_CJK_LENGTH : MIN_NON_CJK_LENGTH;
  if (result.length < minLength) {
    return null;
  }

  // 7. 截断到最大长度
  if (result.length > MAX_LENGTH) {
    result = result.slice(0, MAX_LENGTH);
  }

  return result;
}

/**
 * 用记忆标记包裹内容，注入到 prompt 中
 */
export function wrapMemoryContext(content: string): string {
  return `${MARKERS.EVOCLAW_MEM_START}${content}${MARKERS.EVOCLAW_MEM_END}`;
}

/**
 * 用 RAG 标记包裹内容，注入到 prompt 中
 */
export function wrapRAGContext(content: string): string {
  return `${MARKERS.EVOCLAW_RAG_START}${content}${MARKERS.EVOCLAW_RAG_END}`;
}
