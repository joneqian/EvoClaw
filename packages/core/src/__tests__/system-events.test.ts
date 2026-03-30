import { describe, it, expect, beforeEach } from 'vitest';
import {
  enqueueSystemEvent,
  drainSystemEvents,
  peekSystemEvents,
  hasSystemEvents,
  resetSystemEventsForTest,
} from '../infrastructure/system-events.js';

describe('SystemEvents', () => {
  const sessionKey = 'agent:test:local:direct:user';

  beforeEach(() => {
    resetSystemEventsForTest();
  });

  describe('enqueueSystemEvent', () => {
    it('应入队事件', () => {
      const ok = enqueueSystemEvent('检查邮件', sessionKey);
      expect(ok).toBe(true);
      expect(hasSystemEvents(sessionKey)).toBe(true);
    });

    it('空文本应拒绝', () => {
      expect(enqueueSystemEvent('', sessionKey)).toBe(false);
      expect(enqueueSystemEvent('  ', sessionKey)).toBe(false);
    });

    it('空 sessionKey 应拒绝', () => {
      expect(enqueueSystemEvent('事件', '')).toBe(false);
    });

    it('连续重复文本应去重', () => {
      enqueueSystemEvent('检查邮件', sessionKey);
      const ok = enqueueSystemEvent('检查邮件', sessionKey);
      expect(ok).toBe(false);
      expect(peekSystemEvents(sessionKey)).toHaveLength(1);
    });

    it('非连续重复文本应允许', () => {
      enqueueSystemEvent('事件A', sessionKey);
      enqueueSystemEvent('事件B', sessionKey);
      enqueueSystemEvent('事件A', sessionKey); // 非连续重复
      expect(peekSystemEvents(sessionKey)).toHaveLength(3);
    });

    it('超过容量限制应丢弃最旧事件', () => {
      for (let i = 0; i < 25; i++) {
        enqueueSystemEvent(`事件${i}`, sessionKey);
      }
      const events = peekSystemEvents(sessionKey);
      expect(events).toHaveLength(20);
      expect(events[0]).toBe('事件5'); // 最早的 5 个被丢弃
      expect(events[19]).toBe('事件24');
    });
  });

  describe('drainSystemEvents', () => {
    it('应返回所有事件并清空队列', () => {
      enqueueSystemEvent('事件1', sessionKey);
      enqueueSystemEvent('事件2', sessionKey);

      const drained = drainSystemEvents(sessionKey);
      expect(drained).toEqual(['事件1', '事件2']);
      expect(hasSystemEvents(sessionKey)).toBe(false);
    });

    it('空队列应返回空数组', () => {
      expect(drainSystemEvents(sessionKey)).toEqual([]);
    });

    it('drain 后再次 drain 应返回空', () => {
      enqueueSystemEvent('事件', sessionKey);
      drainSystemEvents(sessionKey);
      expect(drainSystemEvents(sessionKey)).toEqual([]);
    });
  });

  describe('peekSystemEvents', () => {
    it('应返回事件但不清空', () => {
      enqueueSystemEvent('事件1', sessionKey);
      const peeked = peekSystemEvents(sessionKey);
      expect(peeked).toEqual(['事件1']);
      expect(hasSystemEvents(sessionKey)).toBe(true); // 仍存在
    });

    it('不存在的 session 应返回空数组', () => {
      expect(peekSystemEvents('不存在')).toEqual([]);
    });
  });

  describe('hasSystemEvents', () => {
    it('空队列应返回 false', () => {
      expect(hasSystemEvents(sessionKey)).toBe(false);
    });

    it('有事件应返回 true', () => {
      enqueueSystemEvent('事件', sessionKey);
      expect(hasSystemEvents(sessionKey)).toBe(true);
    });
  });

  describe('session 隔离', () => {
    it('不同 session 应独立', () => {
      const session1 = 'agent:a:local:direct:user';
      const session2 = 'agent:b:local:direct:user';

      enqueueSystemEvent('事件A', session1);
      enqueueSystemEvent('事件B', session2);

      expect(peekSystemEvents(session1)).toEqual(['事件A']);
      expect(peekSystemEvents(session2)).toEqual(['事件B']);

      drainSystemEvents(session1);
      expect(hasSystemEvents(session1)).toBe(false);
      expect(hasSystemEvents(session2)).toBe(true);
    });
  });
});
