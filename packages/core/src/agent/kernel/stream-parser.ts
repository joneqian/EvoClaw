/**
 * SSE 行解析器 — 支持 Anthropic + OpenAI 双格式
 *
 * Anthropic SSE 格式:
 *   event: message_start
 *   data: {"type":"message_start","message":{...}}
 *
 * OpenAI SSE 格式:
 *   data: {"id":"...","choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 *
 * 参考 Claude Code 的 raw stream 处理方式:
 * - 使用 O(n) 的 raw stream 而非 O(n²) 的 BetaMessageStream
 * - 逐行解析 SSE，不依赖第三方库
 *
 * 参考文档: docs/research/04-streaming.md
 */

import type { RawSSEEvent } from './types.js';

/**
 * 从 ReadableStream 解析 SSE 事件
 *
 * 逐行处理 SSE 协议:
 * - `event: <type>` 行记录事件类型
 * - `data: <json>` 行携带数据
 * - 空行分隔事件
 * - `data: [DONE]` 表示流结束 (OpenAI)
 *
 * @param stream - HTTP 响应的 ReadableStream
 * @yields RawSSEEvent 包含可选的 event 类型和 data JSON 字符串
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<RawSSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // 流结束，处理 buffer 中剩余数据
        if (buffer.trim()) {
          const result = processLine(buffer, currentEvent);
          if (result) yield result;
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // 逐行处理
      const lines = buffer.split('\n');
      // 最后一行可能不完整，保留在 buffer 中
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
          // 空行: SSE 事件边界，重置 event 类型
          currentEvent = undefined;
          continue;
        }

        if (trimmed.startsWith('event:')) {
          // Anthropic SSE: event: <type>
          currentEvent = trimmed.slice(6).trim();
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();

          // OpenAI 流结束标记
          if (data === '[DONE]') {
            return;
          }

          // 跳过空 data
          if (!data) continue;

          yield { event: currentEvent, data };
          // data 行之后不立即清除 event（同一事件可能有多行 data）
          // 但 Anthropic/OpenAI 实际上每个事件只有一行 data，
          // 所以在下一个空行或 event: 行时重置
          continue;
        }

        // 忽略注释行 (以 : 开头) 和其他非标准行
        if (trimmed.startsWith(':')) {
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 处理单行 SSE 数据
 * @internal 仅用于处理流结束时 buffer 中的剩余行
 */
function processLine(line: string, currentEvent: string | undefined): RawSSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) {
    return null;
  }
  if (trimmed.startsWith('data:')) {
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return null;
    return { event: currentEvent, data };
  }
  return null;
}

/**
 * 安全解析 JSON，解析失败返回 null
 */
export function safeParseJSON<T = unknown>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
