/**
 * M8 Smart Approve — SmartDecisionCache 会话隔离
 *
 * 同 tool + 同 params 但不同 sessionKey 不应命中同一缓存条目，
 * 防止 session A 的评估结果被 session B 复用。
 */
import { describe, it, expect } from 'vitest';
import { SmartDecisionCache, type SmartContext, type SmartDecision } from '../security/smart-approve.js';

const BASE_CTX: SmartContext = {
  toolName: 'bash',
  params: { command: 'ls' },
};
const DECISION_A: SmartDecision = { decision: 'approve', reason: 'safe' };
const DECISION_B: SmartDecision = { decision: 'deny', reason: 'unsafe' };

describe('SmartDecisionCache — 会话隔离', () => {
  it('不同 sessionKey 不共享缓存', () => {
    const cache = new SmartDecisionCache();
    cache.set({ ...BASE_CTX, sessionKey: 'session-1' }, DECISION_A);
    expect(cache.get({ ...BASE_CTX, sessionKey: 'session-1' })?.decision).toBe('approve');
    expect(cache.get({ ...BASE_CTX, sessionKey: 'session-2' })).toBeUndefined();
  });

  it('同 sessionKey 内同 tool+params 复用缓存', () => {
    const cache = new SmartDecisionCache();
    cache.set({ ...BASE_CTX, sessionKey: 's1' }, DECISION_A);
    const hit = cache.get({ ...BASE_CTX, sessionKey: 's1' });
    expect(hit?.decision).toBe('approve');
    expect(hit?.cached).toBe(true);
  });

  it('未传 sessionKey 与传 sessionKey 的条目互不命中', () => {
    const cache = new SmartDecisionCache();
    cache.set(BASE_CTX, DECISION_A);
    expect(cache.get({ ...BASE_CTX, sessionKey: 'x' })).toBeUndefined();
    cache.set({ ...BASE_CTX, sessionKey: 'x' }, DECISION_B);
    expect(cache.get(BASE_CTX)?.decision).toBe('approve');
    expect(cache.get({ ...BASE_CTX, sessionKey: 'x' })?.decision).toBe('deny');
  });
});
