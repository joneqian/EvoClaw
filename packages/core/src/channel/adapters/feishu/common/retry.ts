/**
 * 飞书出站重试外壳
 *
 * 内核已抽到 channel/common/retry.ts（PR Phase A），本文件只负责：
 * - 注入飞书特化的 isRetryable 分类（FeishuApiError code + 网络瞬态）
 * - 暴露 `withFeishuRetry` 兼容 6 个调用点的现有签名
 *
 * 公共常量与工具（`DEFAULT_*` / `extractRetryAfterSeconds` / `computeBackoffDelay`）
 * 直接 re-export 自通用层，外部 import 路径不变。
 */

import {
  withChannelRetry,
  looksLikeTransientNetworkError,
  type ChannelRetryOptions,
} from '../../../common/retry.js';
import { FeishuApiError } from '../outbound/index.js';

export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  extractRetryAfterSeconds,
  computeBackoffDelay,
} from '../../../common/retry.js';

/**
 * 飞书业务码白名单：哪些 code 视为可重试
 *
 * - 99991400 / 99991663 限流
 * - 5xx 家族（SDK 在 HTTP 层已抛 Error，body code 不会带；通过 err.message 判断）
 * - 其它 code 一律不重试（包括 230001 内容错 / 99991664 权限）
 */
const RETRYABLE_CODES = new Set<number>([
  99991400, // rate limit
  99991663, // too many requests
]);

/** 飞书特化的可重试判定 */
export function isRetryableFeishuError(err: unknown): boolean {
  if (err instanceof FeishuApiError) {
    return RETRYABLE_CODES.has(err.code);
  }
  return looksLikeTransientNetworkError(err);
}

/** withFeishuRetry 公开选项（除 isRetryable 由内部注入外，与通用层一致） */
export type RetryOptions = Omit<ChannelRetryOptions, 'isRetryable'>;

/**
 * 对飞书出站动作做 3 次指数退避重试
 *
 * @example
 *   await withFeishuRetry(() => sendTextMessage(client, ...), { label: 'send' });
 */
export function withFeishuRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  return withChannelRetry(fn, {
    ...options,
    isRetryable: isRetryableFeishuError,
    label: options.label ?? 'feishu',
  });
}
