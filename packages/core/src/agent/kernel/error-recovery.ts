/**
 * API 错误分类与恢复 — 参考 Claude Code 错误处理体系
 *
 * 分层恢复策略:
 * - queryLoop 内部处理: 413 (压缩重试), IdleTimeout (非流式回退)
 * - 外层 embedded-runner-loop 处理: 429/529 (退避), 401/402 (切 provider), thinking (降级)
 *
 * 参考 Claude Code:
 * - query.ts 的 413 / max_output_tokens / FallbackTriggered 恢复
 * - services/api/errors.ts 的错误分类
 *
 * 参考文档: docs/research/03-agentic-loop.md, 25-api-integration.md
 */

import { ApiError, IdleTimeoutError } from './types.js';
import type { ErrorType } from '../embedded-runner-errors.js';

// ═══════════════════════════════════════════════════════════════════════════
// Error Classification
// ═══════════════════════════════════════════════════════════════════════════

export interface ClassifiedApiError {
  type: ErrorType;
  message: string;
  retryable: boolean;
  /** HTTP 状态码 (如果有) */
  status?: number;
}

/**
 * 分类 API 错误
 *
 * 优先级:
 * 1. ApiError (有 HTTP status) → 按状态码分类
 * 2. IdleTimeoutError → timeout
 * 3. 正则匹配错误消息 → 推断类型
 * 4. 未知 → unknown
 */
export function classifyApiError(err: unknown): ClassifiedApiError {
  // ApiError (有 HTTP 状态码)
  if (err instanceof ApiError && err.status) {
    const { status, message, responseBody } = err;

    switch (status) {
      case 413:
        return { type: 'overflow', message, retryable: true, status };

      case 429:
        return { type: 'overload', message, retryable: true, status };

      case 529:
        return { type: 'overload', message, retryable: true, status };

      case 401:
      case 403:
        return { type: 'auth', message, retryable: false, status };

      case 402:
        return { type: 'billing', message, retryable: false, status };

      case 408:
        return { type: 'timeout', message, retryable: true, status };

      default:
        if (status >= 500) {
          return { type: 'overload', message, retryable: true, status };
        }
        // 检查 body 中的结构化错误
        return classifyByMessage(message, responseBody, status);
    }
  }

  // IdleTimeoutError (流式空闲超时)
  if (err instanceof IdleTimeoutError) {
    return { type: 'timeout', message: err.message, retryable: true };
  }

  // 一般 Error → 从消息中推断
  const message = err instanceof Error ? err.message : String(err);
  return classifyByMessage(message);
}

/**
 * 从错误消息文本推断错误类型
 */
function classifyByMessage(
  message: string,
  responseBody?: string,
  status?: number,
): ClassifiedApiError {
  const text = `${message} ${responseBody ?? ''}`.toLowerCase();

  // overflow / prompt too long
  if (/prompt.?too.?long|prompt_too_long|context.?length|token.?limit.?exceeded/i.test(text)) {
    return { type: 'overflow', message, retryable: true, status };
  }

  // overload / rate limit
  if (/overloaded|rate.?limit|too.?many.?requests|capacity|throttl/i.test(text)) {
    return { type: 'overload', message, retryable: true, status };
  }

  // auth
  if (/unauthorized|invalid.?api.?key|invalid.?token|authentication/i.test(text)) {
    return { type: 'auth', message, retryable: false, status };
  }

  // billing
  if (/billing|payment|quota.?exceeded|insufficient.?funds/i.test(text)) {
    return { type: 'billing', message, retryable: false, status };
  }

  // thinking / reasoning
  if (/thinking|reasoning|budget_tokens|extended_thinking/i.test(text)) {
    return { type: 'thinking', message, retryable: true, status };
  }

  // timeout
  if (/timeout|timed?.?out|ETIMEDOUT|ECONNRESET|EPIPE/i.test(text)) {
    return { type: 'timeout', message, retryable: true, status };
  }

  return { type: 'unknown', message, retryable: false, status };
}

// ═══════════════════════════════════════════════════════════════════════════
// Recovery Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 判断错误是否应在 queryLoop 内部恢复 (压缩重试)
 * 而非抛给外层 loop
 */
export function isRecoverableInLoop(classified: ClassifiedApiError): boolean {
  // 413 overflow → 循环内压缩重试
  return classified.type === 'overflow' && classified.retryable;
}

/**
 * 判断错误是否应触发循环内模型回退
 *
 * timeout 和 overload 在有 fallbackModel 时尝试循环内回退，
 * 避免抛给外层丢失当前 turn 上下文。
 */
export function isFallbackTrigger(classified: ClassifiedApiError): boolean {
  return classified.type === 'timeout' || classified.type === 'overload';
}

/**
 * 判断错误是否是中止错误
 */
export function isAbortLike(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.message.includes('aborted') || err.message.includes('abort')) return true;
  }
  return false;
}

/** max_output_tokens 恢复消息 (参考 Claude Code) */
export const MAX_OUTPUT_RECOVERY_MESSAGE =
  'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
  'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.';

/** max_output_tokens 最大恢复次数 */
export const MAX_OUTPUT_RECOVERY_LIMIT = 3;
