/**
 * Background Skill Review Trigger 计数器单测
 *
 * 验证：
 * - 每 turn +1
 * - 阈值触发 + 复位
 * - 非主 turn（cron / subagent / heartbeat / boot / background-review）不计数
 * - per (agentId, sessionKey) 隔离
 * - interval=0 / interval<0 → 禁用
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldTriggerBackgroundReview,
  _resetCountersForTests,
  _peekCounter,
  DEFAULT_NUDGE_INTERVAL,
} from '../../skill/skill-background-review-trigger.js';

const AGENT = 'agent-x';
const MAIN_SK = 'agent:agent-x:wechat:dm:peer-1';
const CRON_SK = 'agent:agent-x:cron:job-1';
const SUBAGENT_SK = 'agent:agent-x:local:subagent:task-1';
const HEARTBEAT_SK = 'agent:agent-x:default:direct::heartbeat:p';
const BG_REVIEW_SK = 'agent:agent-x:local:background-review:abc-def';

describe('shouldTriggerBackgroundReview', () => {
  beforeEach(() => _resetCountersForTests());

  it('每次调用 +1，到达 interval 触发并复位', () => {
    for (let i = 1; i < DEFAULT_NUDGE_INTERVAL; i++) {
      const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK });
      expect(r.shouldTrigger).toBe(false);
      expect(r.currentCount).toBe(i);
    }
    // 第 N 次：触发 + 复位
    const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK });
    expect(r.shouldTrigger).toBe(true);
    expect(r.currentCount).toBe(DEFAULT_NUDGE_INTERVAL);
    // 复位后再 +1 应是 1
    expect(_peekCounter(AGENT, MAIN_SK)).toBe(0);
    const next = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK });
    expect(next.shouldTrigger).toBe(false);
    expect(next.currentCount).toBe(1);
  });

  it('自定义 interval=3', () => {
    const r1 = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK, interval: 3 });
    const r2 = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK, interval: 3 });
    const r3 = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK, interval: 3 });
    expect(r1.shouldTrigger).toBe(false);
    expect(r2.shouldTrigger).toBe(false);
    expect(r3.shouldTrigger).toBe(true);
  });

  it('cron sessionKey 不计数', () => {
    for (let i = 0; i < 20; i++) {
      const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: CRON_SK });
      expect(r.shouldTrigger).toBe(false);
      expect(r.reason).toBe('non-privileged-session');
      expect(r.currentCount).toBe(0);
    }
  });

  it('subagent sessionKey 不计数', () => {
    const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: SUBAGENT_SK });
    expect(r.shouldTrigger).toBe(false);
    expect(r.reason).toBe('non-privileged-session');
  });

  it('background-review sessionKey 不计数（防自递归）', () => {
    const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: BG_REVIEW_SK });
    expect(r.shouldTrigger).toBe(false);
    expect(r.reason).toBe('non-privileged-session');
  });

  it('heartbeat sessionKey 仍计数（属主 session 范畴）', () => {
    const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: HEARTBEAT_SK });
    expect(r.shouldTrigger).toBe(false);
    expect(r.currentCount).toBe(1); // 计数了
  });

  it('per (agentId, sessionKey) 隔离', () => {
    // agent-x session-A 跑 5 次
    for (let i = 0; i < 5; i++) {
      shouldTriggerBackgroundReview({ agentId: 'a', sessionKey: 'agent:a:wx:dm:p1' });
    }
    // agent-y session-B 跑 5 次
    for (let i = 0; i < 5; i++) {
      shouldTriggerBackgroundReview({ agentId: 'b', sessionKey: 'agent:b:wx:dm:p1' });
    }
    expect(_peekCounter('a', 'agent:a:wx:dm:p1')).toBe(5);
    expect(_peekCounter('b', 'agent:b:wx:dm:p1')).toBe(5);
    // 互不干扰
    expect(_peekCounter('a', 'agent:b:wx:dm:p1')).toBe(0);
  });

  it('interval=0 禁用触发', () => {
    const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK, interval: 0 });
    expect(r.shouldTrigger).toBe(false);
    expect(r.reason).toBe('interval-disabled');
    // 计数器也不增
    expect(_peekCounter(AGENT, MAIN_SK)).toBe(0);
  });

  it('interval=-5 也算禁用', () => {
    const r = shouldTriggerBackgroundReview({ agentId: AGENT, sessionKey: MAIN_SK, interval: -5 });
    expect(r.shouldTrigger).toBe(false);
    expect(r.reason).toBe('interval-disabled');
  });
});
