/**
 * 企业微信出站重试外壳
 *
 * 与飞书 / 微信 retry 同源（共享 channel/common/retry.ts 的 withChannelRetry 内核），
 * 注入企微特化的 isRetryable 分类。
 *
 * 配套 wecom.ts 的 `WecomApiError` —— 业务 `errcode` 落到 RETRYABLE_ERRCODES 内
 * 才视为可重试。
 */

import {
  withChannelRetry,
  looksLikeTransientNetworkError,
  type ChannelRetryOptions,
} from '../common/retry.js';

export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  extractRetryAfterSeconds,
  computeBackoffDelay,
} from '../common/retry.js';

/**
 * 企微 API 业务错误（HTTP 200 + body.errcode != 0 的场景）。
 *
 * 替换原 `Error("企微发送失败: ${errmsg}")`，保留 errcode 用于精确分类重试 / 业务降级。
 */
export class WecomApiError extends Error {
  constructor(
    public readonly action: string,
    public readonly errcode: number,
    public readonly errmsg: string,
  ) {
    super(`企微${action}失败: errcode=${errcode} ${errmsg}`);
    this.name = 'WecomApiError';
  }
}

/**
 * 企微业务码白名单：哪些 errcode 视为可重试
 *
 * 取自企微开放平台公开错误码：
 * - 45033 接口调用频率过快（典型限流）
 * - 45009 接口调用次数超过限制
 * - 41030 不合法的 page（不应重试，但 transient 网络层一同捕获）
 * - -1 系统繁忙
 *
 * 不重试：40014（access_token 失效，需 refreshToken 后用户层重试）/ 40029（code 失效）等。
 */
const RETRYABLE_ERRCODES = new Set<number>([
  -1, // 系统繁忙
  45009, // 接口调用次数超过限制
  45033, // 接口调用频率过快
]);

/** 企微特化的可重试判定 */
export function isRetryableWecomError(err: unknown): boolean {
  if (err instanceof WecomApiError) {
    return RETRYABLE_ERRCODES.has(err.errcode);
  }
  // 历史 plain Error 兜底：从 'errcode=N' 模式中解析
  if (err instanceof Error) {
    const m = err.message.match(/errcode=(-?\d+)/);
    if (m) {
      const code = parseInt(m[1]!, 10);
      if (RETRYABLE_ERRCODES.has(code)) return true;
    }
  }
  return looksLikeTransientNetworkError(err);
}

/** withWecomRetry 公开选项（除 isRetryable 由内部注入外，与通用层一致） */
export type WecomRetryOptions = Omit<ChannelRetryOptions, 'isRetryable'>;

/**
 * 对企微出站动作做 3 次指数退避重试
 *
 * @example
 *   await withWecomRetry(() => sendMessage(...), { label: 'send' });
 */
export function withWecomRetry<T>(
  fn: () => Promise<T>,
  options: WecomRetryOptions = {},
): Promise<T> {
  return withChannelRetry(fn, {
    ...options,
    isRetryable: isRetryableWecomError,
    label: options.label ?? 'wecom',
  });
}
