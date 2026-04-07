import { describe, it, expect, beforeEach } from 'vitest';
import { DenialTracker } from '../../security/denial-tracker.js';

describe('DenialTracker', () => {
  let tracker: DenialTracker;

  beforeEach(() => {
    tracker = new DenialTracker();
  });

  it('初始计数为 0', () => {
    expect(tracker.getCount()).toBe(0);
  });

  it('记录拒绝递增计数', () => {
    tracker.recordDenial();
    expect(tracker.getCount()).toBe(1);
    tracker.recordDenial();
    expect(tracker.getCount()).toBe(2);
  });

  it('成功调用重置计数', () => {
    tracker.recordDenial();
    tracker.recordDenial();
    tracker.recordSuccess();
    expect(tracker.getCount()).toBe(0);
  });

  it('default 模式: 5 次拒绝触发上限', () => {
    tracker.setMode('default');
    for (let i = 0; i < 4; i++) {
      const result = tracker.recordDenial();
      expect(result.limitReached).toBe(false);
      expect(result.action).toBe('continue');
    }
    const result = tracker.recordDenial();
    expect(result.limitReached).toBe(true);
    expect(result.count).toBe(5);
    expect(result.limit).toBe(5);
    expect(result.action).toBe('stop');
  });

  it('strict 模式: 3 次拒绝触发上限，动作为 abort', () => {
    tracker.setMode('strict');
    tracker.recordDenial();
    tracker.recordDenial();
    const result = tracker.recordDenial();
    expect(result.limitReached).toBe(true);
    expect(result.count).toBe(3);
    expect(result.action).toBe('abort');
  });

  it('permissive 模式: 8 次拒绝触发上限', () => {
    tracker.setMode('permissive');
    for (let i = 0; i < 7; i++) {
      tracker.recordDenial();
    }
    const result = tracker.recordDenial();
    expect(result.limitReached).toBe(true);
    expect(result.count).toBe(8);
    expect(result.limit).toBe(8);
    expect(result.action).toBe('stop');
  });

  it('中途成功重置后重新计数', () => {
    tracker.setMode('default');
    tracker.recordDenial();
    tracker.recordDenial();
    tracker.recordDenial();
    tracker.recordSuccess(); // 重置
    tracker.recordDenial();
    expect(tracker.getCount()).toBe(1);
  });

  it('reset() 手动重置', () => {
    tracker.recordDenial();
    tracker.recordDenial();
    tracker.reset();
    expect(tracker.getCount()).toBe(0);
  });
});
