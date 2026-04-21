/**
 * 飞书出站重试 + 指数退避
 *
 * 设计:
 * - 3 次尝试，退避 1s → 2s → 4s（倍增）
 * - 只重试可恢复错误：网络错误、5xx、限流 (99991400/9499 家族)
 * - 参数/权限/内容非法（230001/230002 等）不重试，直接上抛
 *
 * 参考 Hermes `_feishu_send_with_retry` (gateway/platforms/feishu.py:3783-3840)
 */

import { FeishuApiError } from './outbound.js';
import { createLogger } from '../../../infrastructure/logger.js';

const log = createLogger('feishu-retry');

/** 默认重试次数 */
export const DEFAULT_MAX_ATTEMPTS = 3;
/** 基础退避（ms），实际 = BASE * 2^attempt */
export const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * 飞书 code 分类：哪些应该重试
 *
 * - 99991400 / 99991663 限流
 * - 5xx 家族（SDK 在 HTTP 层已抛 Error，body code 不会带；通过 err.message 判断）
 * - 其它 code 一律不重试（包括 230001 内容错 / 99991664 权限）
 */
const RETRYABLE_CODES = new Set<number>([
  99991400, // rate limit
  99991663, // too many requests
]);

/** Node 系列网络异常 code 白名单 */
const TRANSIENT_NET_CODES = /^E(CONNRESET|CONNREFUSED|TIMEDOUT|AI_AGAIN|NOTFOUND|PIPE|HOSTUNREACH)$/;

/** 非飞书业务错误但属于网络异常（HTTP 5xx / transient code / timeout） */
function looksLikeTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  // 优先检测 Node / undici / axios 都会挂的结构化字段（跨版本稳定）
  const code =
    (err as { code?: unknown }).code ??
    (err as { cause?: { code?: unknown } }).cause?.code;
  if (typeof code === 'string' && TRANSIENT_NET_CODES.test(code)) return true;

  const status =
    (err as { status?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode ??
    (err as { response?: { status?: unknown; statusCode?: unknown } }).response?.status ??
    (err as { response?: { status?: unknown; statusCode?: unknown } }).response?.statusCode;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;

  // 兜底：消息字符串匹配（最后手段，防 SDK 只在 message 里体现）
  if (err instanceof Error) {
    return (
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|timeout/i.test(err.message) ||
      /HTTP 5\d{2}|status code 5\d{2}/i.test(err.message)
    );
  }
  return false;
}

/** 判断是否可重试 */
export function isRetryableFeishuError(err: unknown): boolean {
  if (err instanceof FeishuApiError) {
    return RETRYABLE_CODES.has(err.code);
  }
  return looksLikeTransientNetworkError(err);
}

export interface RetryOptions {
  /** 最大尝试次数（含首次），默认 3 */
  maxAttempts?: number;
  /** 基础退避 ms，默认 1000 */
  baseDelayMs?: number;
  /** 日志前缀（出现在 warn 中） */
  label?: string;
  /** 测试注入：等待实现（默认 setTimeout） */
  sleep?: (ms: number) => Promise<void>;
  /** 测试注入：随机源（默认 Math.random），用于 jitter */
  random?: () => number;
}

/** 默认 sleep 实现 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 对飞书出站动作做 3 次指数退避重试
 *
 * @example
 *   await withFeishuRetry(() => sendTextMessage(client, ...), { label: 'send' });
 */
/**
 * 计算第 N 次失败后的退避延迟：equal jitter 算法
 * delay = max/2 + random * max/2，避免多实例同时限流时整齐重试造成"雪崩"
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  random: () => number = Math.random,
): number {
  const max = baseDelayMs * Math.pow(2, attempt);
  const halfMax = max / 2;
  return Math.floor(halfMax + random() * halfMax);
}

export async function withFeishuRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const label = options.label ?? 'feishu';

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts - 1 || !isRetryableFeishuError(err)) {
        throw err;
      }
      const delay = computeBackoffDelay(attempt, baseDelay, random);
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        `[${label}] 第 ${attempt + 1}/${maxAttempts} 次失败，${delay}ms 后重试: ${msg}`,
      );
      await sleep(delay);
    }
  }
  // 理论不可达（循环内 throw），但 TS 要求
  throw lastError ?? new Error(`withFeishuRetry unreachable for ${label}`);
}
