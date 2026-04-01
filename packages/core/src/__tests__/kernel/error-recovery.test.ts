/**
 * 错误恢复测试
 *
 * 覆盖:
 * - classifyApiError: HTTP 状态码分类
 * - classifyApiError: 消息文本推断
 * - isRecoverableInLoop: 循环内恢复判断
 * - isAbortLike: 中止错误检测
 */

import { describe, it, expect } from 'vitest';
import { classifyApiError, isRecoverableInLoop, isAbortLike } from '../../agent/kernel/error-recovery.js';
import { ApiError, IdleTimeoutError } from '../../agent/kernel/types.js';

describe('classifyApiError', () => {
  // ─── HTTP Status Codes ───

  it('should classify 413 as overflow', () => {
    const result = classifyApiError(new ApiError('too long', 413));
    expect(result.type).toBe('overflow');
    expect(result.retryable).toBe(true);
  });

  it('should classify 429 as overload', () => {
    const result = classifyApiError(new ApiError('rate limited', 429));
    expect(result.type).toBe('overload');
    expect(result.retryable).toBe(true);
  });

  it('should classify 529 as overload', () => {
    const result = classifyApiError(new ApiError('overloaded', 529));
    expect(result.type).toBe('overload');
    expect(result.retryable).toBe(true);
  });

  it('should classify 401 as auth', () => {
    const result = classifyApiError(new ApiError('unauthorized', 401));
    expect(result.type).toBe('auth');
    expect(result.retryable).toBe(false);
  });

  it('should classify 402 as billing', () => {
    const result = classifyApiError(new ApiError('payment required', 402));
    expect(result.type).toBe('billing');
    expect(result.retryable).toBe(false);
  });

  it('should classify 5xx as overload', () => {
    const result = classifyApiError(new ApiError('internal error', 500));
    expect(result.type).toBe('overload');
    expect(result.retryable).toBe(true);
  });

  // ─── IdleTimeoutError ───

  it('should classify IdleTimeoutError as timeout', () => {
    const result = classifyApiError(new IdleTimeoutError(90_000));
    expect(result.type).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  // ─── Message-based classification ───

  it('should classify prompt_too_long message as overflow', () => {
    const result = classifyApiError(new Error('prompt_too_long: input is too large'));
    expect(result.type).toBe('overflow');
  });

  it('should classify rate limit message as overload', () => {
    const result = classifyApiError(new Error('too many requests'));
    expect(result.type).toBe('overload');
  });

  it('should classify invalid api key as auth', () => {
    const result = classifyApiError(new Error('Invalid API key'));
    expect(result.type).toBe('auth');
  });

  it('should classify thinking error', () => {
    const result = classifyApiError(new Error('budget_tokens must be positive'));
    expect(result.type).toBe('thinking');
  });

  it('should classify ETIMEDOUT as timeout', () => {
    const result = classifyApiError(new Error('connect ETIMEDOUT'));
    expect(result.type).toBe('timeout');
  });

  it('should classify unknown errors', () => {
    const result = classifyApiError(new Error('something weird'));
    expect(result.type).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('should handle non-Error values', () => {
    const result = classifyApiError('string error');
    expect(result.type).toBe('unknown');
    expect(result.message).toBe('string error');
  });
});

describe('isRecoverableInLoop', () => {
  it('should return true for overflow', () => {
    expect(isRecoverableInLoop({ type: 'overflow', message: '', retryable: true })).toBe(true);
  });

  it('should return false for overload (handled by outer loop)', () => {
    expect(isRecoverableInLoop({ type: 'overload', message: '', retryable: true })).toBe(false);
  });

  it('should return false for auth', () => {
    expect(isRecoverableInLoop({ type: 'auth', message: '', retryable: false })).toBe(false);
  });
});

describe('isAbortLike', () => {
  it('should detect AbortError by name', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isAbortLike(err)).toBe(true);
  });

  it('should detect abort in message', () => {
    expect(isAbortLike(new Error('The operation was aborted'))).toBe(true);
  });

  it('should return false for other errors', () => {
    expect(isAbortLike(new Error('something else'))).toBe(false);
  });
});
