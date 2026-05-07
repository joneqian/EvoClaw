/**
 * Background Skill Review 触发计数器（per agent + sessionKey 维度）
 *
 * 每次 turn 结束 increment 1。≥ N=10 时触发 background review，并复位。
 * 仅主 turn（非 cron / subagent / heartbeat / boot / background-review）计数。
 *
 * 灵感来自 Hermes `_iters_since_skill` + `_skill_nudge_interval`。
 *
 * 进程内状态（Map），sidecar 重启会复位 — 这是有意为之：
 * - 重启意味着对话状态本来就 reset
 * - 跨进程持久化没价值，触发是软约束（差几个 turn 也无所谓）
 */

import { isPrivilegedSessionKey } from '../routing/session-key.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-bg-review-trigger');

/** 默认触发间隔（参考 Hermes _skill_nudge_interval=10） */
export const DEFAULT_NUDGE_INTERVAL = 10;

/** Map key 格式：`${agentId}::${sessionKey}` */
type CounterKey = string;

const counters = new Map<CounterKey, number>();

function makeKey(agentId: string, sessionKey: string): CounterKey {
  return `${agentId}::${sessionKey}`;
}

export interface ShouldTriggerInput {
  agentId: string;
  sessionKey: string;
  /** 触发间隔（默认 10） */
  interval?: number;
}

export interface ShouldTriggerResult {
  /** 是否触发 */
  shouldTrigger: boolean;
  /** 当前计数值（增加后） */
  currentCount: number;
  /** 跳过原因（不触发时填） */
  reason?: string;
}

/**
 * Increment 计数器并判断是否应触发。命中阈值时复位。
 *
 * 使用：每个 turn 结束（afterTurn 后）调用一次。返回值告诉调用方"现在该触发不"。
 * 失败安全：只在内存里操作，不抛异常。
 */
export function shouldTriggerBackgroundReview(input: ShouldTriggerInput): ShouldTriggerResult {
  // 1) 非主 turn 不计数（cron / subagent / heartbeat / boot / 已是 background-review）
  if (!isPrivilegedSessionKey(input.sessionKey)) {
    log.debug(`[skip] reason=non-privileged session=${input.sessionKey}`);
    return { shouldTrigger: false, currentCount: 0, reason: 'non-privileged-session' };
  }

  const interval = input.interval ?? DEFAULT_NUDGE_INTERVAL;
  if (interval <= 0) {
    return { shouldTrigger: false, currentCount: 0, reason: 'interval-disabled' };
  }

  const key = makeKey(input.agentId, input.sessionKey);
  const current = (counters.get(key) ?? 0) + 1;

  if (current >= interval) {
    counters.set(key, 0); // 复位
    log.info(`[trigger] agent=${input.agentId} session=${input.sessionKey} count=${current} >= interval=${interval}`);
    return { shouldTrigger: true, currentCount: current };
  }

  counters.set(key, current);
  return { shouldTrigger: false, currentCount: current, reason: 'below-interval' };
}

/** 仅供测试用：清空所有计数器 */
export function _resetCountersForTests(): void {
  counters.clear();
}

/** 仅供测试 / 排障用：读取当前计数（不增加） */
export function _peekCounter(agentId: string, sessionKey: string): number {
  return counters.get(makeKey(agentId, sessionKey)) ?? 0;
}
