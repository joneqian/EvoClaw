/**
 * M6 T1: provider-key-state 单测
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getNextKey,
  markKeyFailed,
  getKeyState,
  getProviderKeyStatus,
  resetKeyState,
  clearProviderKeyState,
  type CredentialPoolConfig,
} from '../../infrastructure/provider-key-state.js';

function makePool(strategy: 'failover' | 'round-robin', ids: string[]): CredentialPoolConfig {
  return {
    strategy,
    keys: ids.map((id) => ({ id, apiKey: `sk-${id}`, enabled: true })),
  };
}

describe('M6 T1 — provider-key-state', () => {
  beforeEach(() => {
    clearProviderKeyState('test');
  });

  describe('failover 策略', () => {
    it('按声明顺序返回第一把可用 key', () => {
      const pool = makePool('failover', ['primary', 'secondary', 'tertiary']);
      const result = getNextKey('test', pool);
      expect(result).toEqual({ id: 'primary', apiKey: 'sk-primary' });
    });

    it('主 key 失败（auth）后自动跳到 secondary', () => {
      const pool = makePool('failover', ['primary', 'secondary']);
      markKeyFailed('test', 'primary', 'auth');
      const result = getNextKey('test', pool);
      expect(result?.id).toBe('secondary');
    });

    it('auth 失败为永久禁用', () => {
      markKeyFailed('test', 'primary', 'auth');
      expect(getKeyState('test', 'primary').disabled).toBe(true);
    });

    it('rate-limit 失败会 cooldown 60s 但不永久禁用', () => {
      markKeyFailed('test', 'primary', 'rate-limit');
      const state = getKeyState('test', 'primary');
      expect(state.disabled).toBe(false);
      expect(state.cooldownUntil).toBeTruthy();
      expect(state.cooldownUntil! - Date.now()).toBeGreaterThan(50_000);
    });

    it('所有 key 失败时返回 null', () => {
      const pool = makePool('failover', ['primary', 'secondary']);
      markKeyFailed('test', 'primary', 'auth');
      markKeyFailed('test', 'secondary', 'auth');
      expect(getNextKey('test', pool)).toBeNull();
    });

    it('excludeKeyId 排除指定 key（用于失败后同一调用的重试）', () => {
      const pool = makePool('failover', ['primary', 'secondary', 'tertiary']);
      const result = getNextKey('test', pool, 'primary');
      expect(result?.id).toBe('secondary');
    });

    it('enabled=false 的 key 被跳过', () => {
      const pool: CredentialPoolConfig = {
        strategy: 'failover',
        keys: [
          { id: 'primary', apiKey: 'sk-p', enabled: false },
          { id: 'secondary', apiKey: 'sk-s', enabled: true },
        ],
      };
      expect(getNextKey('test', pool)?.id).toBe('secondary');
    });
  });

  describe('round-robin 策略', () => {
    it('按顺序依次推进，每次调用用下一把', () => {
      const pool = makePool('round-robin', ['a', 'b', 'c']);
      expect(getNextKey('test', pool)?.id).toBe('a');
      expect(getNextKey('test', pool)?.id).toBe('b');
      expect(getNextKey('test', pool)?.id).toBe('c');
      expect(getNextKey('test', pool)?.id).toBe('a'); // 回绕
    });

    it('失败的 key 不再参与轮询', () => {
      const pool = makePool('round-robin', ['a', 'b', 'c']);
      markKeyFailed('test', 'b', 'auth');
      // 候选只剩 a, c
      const ids = [getNextKey('test', pool)?.id, getNextKey('test', pool)?.id, getNextKey('test', pool)?.id];
      expect(ids.every((id) => id === 'a' || id === 'c')).toBe(true);
      // 在 a,c 两者之间轮转
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('getProviderKeyStatus', () => {
    it('返回所有记录过失败的 key 状态快照', () => {
      markKeyFailed('test', 'a', 'auth');
      markKeyFailed('test', 'b', 'rate-limit');
      const status = getProviderKeyStatus('test');
      expect(status.a.disabled).toBe(true);
      expect(status.b.cooldownUntil).toBeTruthy();
    });

    it('无失败记录返回空对象', () => {
      expect(getProviderKeyStatus('test')).toEqual({});
    });
  });

  describe('resetKeyState 用户手动重新启用', () => {
    it('清除单把 key 的状态', () => {
      markKeyFailed('test', 'a', 'auth');
      expect(getKeyState('test', 'a').disabled).toBe(true);
      resetKeyState('test', 'a');
      expect(getKeyState('test', 'a').disabled).toBe(false);
      expect(getKeyState('test', 'a').failCount).toBe(0);
    });
  });
});
