/**
 * 微信（iLink Bot 平台）出站重试外壳
 *
 * 与飞书 retry 同源（共享 channel/common/retry.ts 的 withChannelRetry 内核），
 * 注入微信特化的 isRetryable 分类。
 *
 * 配套 weixin-api.ts 的 `WeixinApiError` —— 业务码 `ret` 落到 RETRYABLE_RETS 内
 * 才视为可重试。其他错（鉴权失败、参数错）一律上抛，避免无效重发。
 *
 * 安全约束：调用方需保证 fn 闭包内可重入（如 `client_id` 生成不应在重试间变化，
 * 否则服务端会把同一条逻辑消息当成多条投递）。weixin-api.ts 已把 client_id
 * 提到 sendMessage 外层一次生成。
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
 * iLink Bot 业务错误（HTTP 200 + body.ret != 0 的场景）。
 *
 * 把原 `Error("iLink sendMessage 失败: ret=N msg")` 升级为带结构化字段的子类，
 * 让 isRetryable 能精确判定 ret 而不是字符串解析（解析依然作为兜底）。
 */
export class WeixinApiError extends Error {
  constructor(
    public readonly action: string,
    public readonly ret: number,
    public readonly errmsg: string,
  ) {
    super(`iLink ${action} 失败: ret=${ret} ${errmsg}`);
    this.name = 'WeixinApiError';
  }
}

/**
 * 微信 iLink 业务码白名单：哪些 ret 视为可重试
 *
 * iLink Bot 平台是逆向接入（无官方文档），保守起见仅把 -1（系统/网络异常通用码）
 * 列入。实际遇到的具体限流码补充进来即可。其他 ret（鉴权失败 / 参数错 / context_token
 * 失效等）一律不重试，避免连续打到同一限制点。
 */
const RETRYABLE_RETS = new Set<number>([
  -1, // 系统/网络异常（iLink 通用兜底码）
]);

/** 兜底：从 'iLink xxx 失败: ret=N ...' 类历史消息中正则解析 ret */
function tryParseRetFromMessage(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const m = err.message.match(/ret=(-?\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

/** 微信特化的可重试判定 */
export function isRetryableWeixinError(err: unknown): boolean {
  if (err instanceof WeixinApiError) {
    return RETRYABLE_RETS.has(err.ret);
  }
  // 历史 plain Error 形式（旧 throw 残留）：解析 ret
  const parsed = tryParseRetFromMessage(err);
  if (parsed !== null && RETRYABLE_RETS.has(parsed)) {
    return true;
  }
  return looksLikeTransientNetworkError(err);
}

/** withWeixinRetry 公开选项（除 isRetryable 由内部注入外，与通用层一致） */
export type WeixinRetryOptions = Omit<ChannelRetryOptions, 'isRetryable'>;

/**
 * 对微信出站动作做 3 次指数退避重试
 *
 * @example
 *   await withWeixinRetry(() => sendMessage(...), { label: 'send' });
 */
export function withWeixinRetry<T>(
  fn: () => Promise<T>,
  options: WeixinRetryOptions = {},
): Promise<T> {
  return withChannelRetry(fn, {
    ...options,
    isRetryable: isRetryableWeixinError,
    label: options.label ?? 'weixin',
  });
}
