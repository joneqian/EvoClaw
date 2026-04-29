/**
 * LoopGuard 单元测试
 *
 * 五层熔断覆盖：
 *   1. 链深度
 *   2. 群速率限流
 *   3. 乒乓熔断（同 task 反复）+ 多 task 不误判
 *   4. 自 @ 自
 *   5. 硬熔断 + 进入熔断期后所有消息被拦
 *   + Feature flag 关闭 / task status 变更清乒乓
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LoopGuard,
  MAX_CHAIN_DEPTH,
  GROUP_MSG_RATE_LIMIT,
  HARD_CIRCUIT_LIMIT,
  PING_PONG_THRESHOLD,
} from '../../agent/team-mode/loop-guard.js';

describe('LoopGuard', () => {
  let guard: LoopGuard;
  const KEY = 'feishu:chat:oc_test';
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    guard = new LoopGuard();
  });

  it('正常 peer 消息 → pass', () => {
    const decision = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      chainDepth: 0,
      now: NOW,
    });
    expect(decision.result).toBe('pass');
  });

  it('自 @ 自即使 enabled=false 也拦', () => {
    const g = new LoopGuard({ enabled: false });
    const decision = g.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a1',
      now: NOW,
    });
    expect(decision.result).toBe('block');
    if (decision.result === 'block') expect(decision.reason).toBe('self_mention');
  });

  it('feature flag 关闭 → 除自 @ 外全 pass', () => {
    const g = new LoopGuard({ enabled: false });
    const dec = g.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      chainDepth: 999, // 超限也放行
      now: NOW,
    });
    expect(dec.result).toBe('pass');
  });

  it('链深度 ≥ MAX_CHAIN_DEPTH → block', () => {
    const decision = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      chainDepth: MAX_CHAIN_DEPTH,
      now: NOW,
    });
    expect(decision.result).toBe('block');
    if (decision.result === 'block') expect(decision.reason).toBe('chain_depth_exceeded');
  });

  it('群速率限流：超 GROUP_MSG_RATE_LIMIT → block + 后续 pause 期内继续 block', () => {
    let lastDecision = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      now: NOW,
    });
    expect(lastDecision.result).toBe('pass');

    // 灌满到刚刚超过限流
    for (let i = 1; i < GROUP_MSG_RATE_LIMIT + 1; i++) {
      lastDecision = guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: `a${(i % 3) + 1}`,
        toAgentId: `a${((i + 1) % 3) + 1}`,
        // 故意用不同 from/to 避免乒乓干扰
        now: NOW + i * 100,
      });
    }
    expect(lastDecision.result).toBe('block');
    if (lastDecision.result === 'block') {
      expect(['rate_limited', 'rate_paused']).toContain(lastDecision.reason);
    }

    // pause 期内再来一条 → 仍 block
    const inPause = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      now: NOW + 1000,
    });
    expect(inPause.result).toBe('block');
  });

  it('乒乓熔断：同 task 互 @ ≥ PING_PONG_THRESHOLD → freeze', () => {
    let dec;
    for (let i = 0; i < PING_PONG_THRESHOLD; i++) {
      dec = guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: i % 2 === 0 ? 'a1' : 'a2',
        toAgentId: i % 2 === 0 ? 'a2' : 'a1',
        taskId: 't1',
        now: NOW + i * 100,
      });
    }
    expect(dec!.result).toBe('block');
    if (dec!.result === 'block') expect(dec!.reason).toBe('ping_pong_freeze');
  });

  it('乒乓不误判：多个 task 互 @ → pass', () => {
    let dec;
    for (let i = 0; i < PING_PONG_THRESHOLD + 2; i++) {
      dec = guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: i % 2 === 0 ? 'a1' : 'a2',
        toAgentId: i % 2 === 0 ? 'a2' : 'a1',
        taskId: `t${i}`, // 每次不同 task
        now: NOW + i * 100,
      });
    }
    expect(dec!.result).toBe('pass');
  });

  it('notifyTaskStatusChanged 清掉乒乓累积', () => {
    // 累 PING_PONG_THRESHOLD-1 次，差一次熔断
    for (let i = 0; i < PING_PONG_THRESHOLD - 1; i++) {
      guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: i % 2 === 0 ? 'a1' : 'a2',
        toAgentId: i % 2 === 0 ? 'a2' : 'a1',
        taskId: 't1',
        now: NOW + i * 100,
      });
    }

    // 任务状态变更 → 清掉
    guard.notifyTaskStatusChanged('t1');

    // 再来一次同 pair 同 task：从 1 开始累，不会立刻熔断
    const dec = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      taskId: 't1',
      now: NOW + 100_000,
    });
    expect(dec.result).toBe('pass');
  });

  it('硬熔断：超 HARD_CIRCUIT_LIMIT → 进入 5 min 熔断期', () => {
    let dec;
    // 灌到刚好超 HARD_CIRCUIT_LIMIT
    for (let i = 0; i <= HARD_CIRCUIT_LIMIT; i++) {
      dec = guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: `a${(i % 5) + 1}`,
        toAgentId: `a${((i + 1) % 5) + 1}`,
        // 用 5 个 agent + 不同 task 避开乒乓和 pair 限频
        taskId: `t${i}`,
        now: NOW + i * 50,
      });
    }
    expect(dec!.result).toBe('block');
    if (dec!.result === 'block') {
      expect(['hard_circuit', 'rate_limited', 'rate_paused']).toContain(dec!.reason);
    }

    // 进入熔断期后任意消息也被拦
    const after = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'aX',
      toAgentId: 'aY',
      taskId: 'tBrand',
      chainDepth: 0,
      now: NOW + HARD_CIRCUIT_LIMIT * 50 + 5_000, // 5s 后
    });
    expect(after.result).toBe('block');
  });

  it('reset 清空所有状态', () => {
    guard.evaluate({ groupSessionKey: KEY, fromAgentId: 'a1', toAgentId: 'a2', now: NOW });
    guard.reset();
    const rec = guard._peekRate(KEY);
    expect(rec).toBeUndefined();
  });

  it('setEnabled 切换 feature flag', () => {
    expect(guard.isEnabled()).toBe(true);
    guard.setEnabled(false);
    expect(guard.isEnabled()).toBe(false);
    const dec = guard.evaluate({
      groupSessionKey: KEY,
      fromAgentId: 'a1',
      toAgentId: 'a2',
      chainDepth: 999,
      now: NOW,
    });
    expect(dec.result).toBe('pass');
  });
});
