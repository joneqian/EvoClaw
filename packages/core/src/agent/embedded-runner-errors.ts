/**
 * 错误分类器 — 将 runner / LLM 错误归类为可恢复类型
 *
 * 参考 OpenClaw: src/agents/pi-embedded-runner/run.ts 的错误处理分支
 * 外层重试循环根据错误类型决定恢复策略（退避/切 provider/降级/裁剪）
 */

/** 错误类型 */
export type ErrorType =
  | 'overload'   // 429/529, rate limit — 退避重试，3 次后切 provider
  | 'thinking'   // reasoning/thinking 不支持 — 降级 reasoning=false
  | 'overflow'   // context length exceeded — 裁剪消息 + tool result 截断
  | 'auth'       // 401, invalid key — 立即切 provider
  | 'billing'    // credit balance, payment — 立即切 provider
  | 'abort'      // AbortError — 不重试
  | 'timeout'    // runner 超时 — 不重试
  | 'unknown';   // 未识别 — 不重试

/** 错误分类结果 */
export interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  message: string;
}

/** 将错误归类为可恢复类型 */
export function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);

  // Overload / Rate limit (429, 529)
  if (/\b(429|529)\b/.test(msg) || /overloaded|rate.?limit/i.test(msg)) {
    return { type: 'overload', retryable: true, message: msg };
  }

  // Thinking / Reasoning 不支持
  if (/thinking|reasoning.*not.*support/i.test(msg)) {
    return { type: 'thinking', retryable: true, message: msg };
  }

  // Context overflow
  if (/context.?length.?exceed|max.?context|too.?many.?tokens/i.test(msg)) {
    return { type: 'overflow', retryable: true, message: msg };
  }

  // Auth 错误
  if (/unauthorized|invalid.*key|invalid.*api|authentication/i.test(msg)) {
    return { type: 'auth', retryable: false, message: msg };
  }

  // Billing / 额度不足
  if (/billing|credit.*balance|payment|too low to access/i.test(msg)) {
    return { type: 'billing', retryable: false, message: msg };
  }

  // Abort
  if (isAbortError(err)) {
    return { type: 'abort', retryable: false, message: msg };
  }

  // runner 超时
  if (/runner 超时|runner.*timeout/i.test(msg)) {
    return { type: 'timeout', retryable: false, message: msg };
  }

  return { type: 'unknown', retryable: false, message: msg };
}

/** 检测是否为 AbortError（参考 OpenClaw abort.ts） */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = 'name' in err ? String((err as any).name) : '';
  if (name === 'AbortError') return true;
  const message = 'message' in err && typeof (err as any).message === 'string'
    ? (err as any).message.toLowerCase()
    : '';
  return message.includes('aborted');
}

/** 检测是否为不可重试的错误（400 系列、billing、auth 等） */
export function isNonRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b400\b.*invalid_request|不可重试/i.test(msg);
}
