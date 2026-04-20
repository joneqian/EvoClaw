/**
 * M6 T1: Provider 凭据池运行时状态管理
 *
 * 维护每个 Provider 的每把 Key 的失败计数 / 永久禁用 / cooldown 状态，
 * 以及 round-robin 策略的游标。
 *
 * 内存态（进程重启清空）— 永久禁用场景由用户在 UI 主动标记 enabled=false
 * 持久到配置文件。
 */

export type KeyFailureReason = 'auth' | 'rate-limit' | 'service-unavailable' | 'network' | 'unknown';

/** 单把 Key 的运行时状态 */
export interface KeyState {
  failCount: number;
  lastFailAt?: number;
  /** cooldown 结束时刻（epoch ms），当前时间小于它时视为不可用 */
  cooldownUntil?: number;
  /** 永久禁用（一般 auth 错误，401/403） */
  disabled: boolean;
  reason?: KeyFailureReason;
}

/** Provider 凭据池配置条目 */
export interface CredentialPoolKeyConfig {
  id: string;
  apiKey: string;
  enabled: boolean;
}

/** Provider 凭据池配置 */
export interface CredentialPoolConfig {
  strategy: 'failover' | 'round-robin';
  keys: CredentialPoolKeyConfig[];
}

/** 限流冷却时长 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;
/** 服务不可用冷却时长 */
const SERVICE_UNAVAILABLE_COOLDOWN_MS = 30_000;

/** 按 Provider 分组的 Key 状态映射 */
const keyStates = new Map<string, Map<string, KeyState>>();
/** round-robin 策略的游标（按 Provider） */
const rrPointers = new Map<string, number>();

/** 获取某把 Key 的状态；若不存在返回初始状态（不落盘） */
export function getKeyState(providerId: string, keyId: string): KeyState {
  const inner = keyStates.get(providerId);
  return inner?.get(keyId) ?? { failCount: 0, disabled: false };
}

/** 读取该 Provider 全部 Key 状态快照（用于 UI 回显） */
export function getProviderKeyStatus(providerId: string): Record<string, KeyState> {
  const inner = keyStates.get(providerId);
  const out: Record<string, KeyState> = {};
  if (inner) {
    for (const [id, state] of inner) {
      out[id] = { ...state };
    }
  }
  return out;
}

/** 标记某把 Key 失败 */
export function markKeyFailed(
  providerId: string,
  keyId: string,
  reason: KeyFailureReason,
): void {
  let inner = keyStates.get(providerId);
  if (!inner) {
    inner = new Map();
    keyStates.set(providerId, inner);
  }
  const prev = inner.get(keyId) ?? { failCount: 0, disabled: false };
  const now = Date.now();
  const next: KeyState = {
    failCount: prev.failCount + 1,
    lastFailAt: now,
    disabled: prev.disabled,
    reason,
  };
  if (reason === 'auth') {
    // 认证失败 → 永久禁用（直到用户介入）
    next.disabled = true;
  } else if (reason === 'rate-limit') {
    next.cooldownUntil = now + RATE_LIMIT_COOLDOWN_MS;
  } else if (reason === 'service-unavailable') {
    next.cooldownUntil = now + SERVICE_UNAVAILABLE_COOLDOWN_MS;
  }
  inner.set(keyId, next);
}

/** 手动重置某把 Key（用户在 UI 点击「重新启用」时调用） */
export function resetKeyState(providerId: string, keyId: string): void {
  const inner = keyStates.get(providerId);
  if (inner) inner.delete(keyId);
}

/** 清空某 Provider 全部状态（用于单测） */
export function clearProviderKeyState(providerId: string): void {
  keyStates.delete(providerId);
  rrPointers.delete(providerId);
}

/** 判断某 Key 当前是否可用（enabled + 非 disabled + 非 cooldown 中） */
function isKeyAvailable(key: CredentialPoolKeyConfig, state: KeyState): boolean {
  if (!key.enabled) return false;
  if (state.disabled) return false;
  if (state.cooldownUntil && Date.now() < state.cooldownUntil) return false;
  return true;
}

/**
 * 从凭据池中选取下一个可用 Key。
 *
 * @param providerId Provider 标识
 * @param pool 凭据池配置
 * @param excludeKeyId 本次调用中已失败的 key id（用于失败后重试时排除）
 * @returns { id, apiKey } 或 null（所有 key 都不可用）
 */
export function getNextKey(
  providerId: string,
  pool: CredentialPoolConfig,
  excludeKeyId?: string,
): { id: string; apiKey: string } | null {
  if (!pool.keys || pool.keys.length === 0) return null;

  const candidates = pool.keys.filter((k) => {
    if (excludeKeyId && k.id === excludeKeyId) return false;
    const state = getKeyState(providerId, k.id);
    return isKeyAvailable(k, state);
  });

  if (candidates.length === 0) return null;

  if (pool.strategy === 'round-robin') {
    const ptr = rrPointers.get(providerId) ?? 0;
    const chosen = candidates[ptr % candidates.length];
    rrPointers.set(providerId, ptr + 1);
    return { id: chosen.id, apiKey: chosen.apiKey };
  }

  // failover: 按 pool.keys 声明顺序取第一个可用
  return { id: candidates[0].id, apiKey: candidates[0].apiKey };
}
