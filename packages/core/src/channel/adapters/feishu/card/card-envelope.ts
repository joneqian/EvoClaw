/**
 * EvoClaw 飞书卡片交互 envelope
 *
 * 卡片按钮 `action.value` 的自定义 JSON 包装（参考 OpenClaw 的 ocf1 envelope）：
 *
 * {
 *   "oc": "ecf1",                  // 版本标识（EvoClaw Feishu v1）
 *   "k": "button" | "approval",    // kind，用于分发
 *   "a": "action_id",              // 动作唯一标识
 *   "m": {...},                    // 业务 metadata（可选）
 *   "c": {                         // 上下文 / 校验字段
 *     "u": "operator_open_id",     // 预期操作者 open_id（可选，空则不限）
 *     "s": "session_key",          // 关联 session key（过滤越权调用）
 *     "e": 1700000000000           // 过期毫秒时间戳
 *   }
 * }
 *
 * 命名缩写刻意保持短，飞书卡片 `value` 在 JSON-stringify 后有长度上限。
 */

export const FEISHU_ENVELOPE_VERSION = 'ecf1' as const;

/** 卡片 action 种类 */
export type FeishuCardActionKind = 'button' | 'approval' | 'command';

/** 卡片交互 envelope */
export interface FeishuCardEnvelope<M = Record<string, unknown>> {
  oc: typeof FEISHU_ENVELOPE_VERSION;
  k: FeishuCardActionKind;
  a: string;
  m?: M;
  c: {
    u?: string;
    s: string;
    e: number;
  };
}

/** 构造 envelope 的参数 */
export interface CreateEnvelopeParams<M = Record<string, unknown>> {
  kind: FeishuCardActionKind;
  actionId: string;
  sessionKey: string;
  /** 预期操作者（仅此 open_id 的点击有效；不传则任何人可点） */
  operatorOpenId?: string;
  /** metadata，会原样回传 */
  metadata?: M;
  /** TTL 毫秒（默认 10 分钟；审批类建议延长到 24h） */
  ttlMs?: number;
}

/** 默认 TTL：10 分钟 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** 构造 envelope（挂到 action.value） */
export function createEnvelope<M = Record<string, unknown>>(
  params: CreateEnvelopeParams<M>,
  now: number = Date.now(),
): FeishuCardEnvelope<M> {
  const env: FeishuCardEnvelope<M> = {
    oc: FEISHU_ENVELOPE_VERSION,
    k: params.kind,
    a: params.actionId,
    c: {
      s: params.sessionKey,
      e: now + (params.ttlMs ?? DEFAULT_TTL_MS),
    },
  };
  if (params.operatorOpenId) env.c.u = params.operatorOpenId;
  if (params.metadata !== undefined) env.m = params.metadata;
  return env;
}

/** 解码结果 */
export type EnvelopeDecodeResult<M = Record<string, unknown>> =
  | { ok: true; envelope: FeishuCardEnvelope<M> }
  | { ok: false; reason: 'invalid_shape' | 'version_mismatch' | 'expired' | 'session_mismatch' | 'operator_mismatch' };

/** 解码与基础校验 */
export function decodeEnvelope<M = Record<string, unknown>>(
  raw: unknown,
  options?: {
    expectedSessionKey?: string;
    operatorOpenId?: string;
    now?: number;
  },
): EnvelopeDecodeResult<M> {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid_shape' };
  const rec = raw as Record<string, unknown>;
  if (rec['oc'] !== FEISHU_ENVELOPE_VERSION) {
    return { ok: false, reason: rec['oc'] === undefined ? 'invalid_shape' : 'version_mismatch' };
  }
  if (typeof rec['k'] !== 'string' || typeof rec['a'] !== 'string') {
    return { ok: false, reason: 'invalid_shape' };
  }
  const c = rec['c'];
  if (!c || typeof c !== 'object') return { ok: false, reason: 'invalid_shape' };
  const cRec = c as Record<string, unknown>;
  if (typeof cRec['s'] !== 'string' || typeof cRec['e'] !== 'number') {
    return { ok: false, reason: 'invalid_shape' };
  }

  const now = options?.now ?? Date.now();
  if (cRec['e'] < now) return { ok: false, reason: 'expired' };

  if (options?.expectedSessionKey && cRec['s'] !== options.expectedSessionKey) {
    return { ok: false, reason: 'session_mismatch' };
  }
  if (
    options?.operatorOpenId &&
    cRec['u'] !== undefined &&
    cRec['u'] !== options.operatorOpenId
  ) {
    return { ok: false, reason: 'operator_mismatch' };
  }

  return {
    ok: true,
    envelope: rec as unknown as FeishuCardEnvelope<M>,
  };
}
