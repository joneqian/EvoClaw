/**
 * IdleWatchdog 单元测试 — 主超时机制（M13 重构）
 *
 * 覆盖：
 *   - touch() 重置 timeout / warning
 *   - warning 70% 阈值一次性触发（不重复）
 *   - timeout 100% 阈值触发后自动停止
 *   - pause / resume 兼容 compaction
 *   - stop 后 touch 不再 arm
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleWatchdog } from '../../agent/kernel/idle-watchdog.js';

describe('IdleWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() 后 idleMs 内无 touch → 触发 onTimeout', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, onTimeout });
    wd.start();
    expect(wd.timedOut).toBe(false);

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(wd.timedOut).toBe(true);
  });

  it('warningRatio=0.7 → 700ms 时触发 onWarning', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, warningRatio: 0.7, onWarning, onTimeout });
    wd.start();

    vi.advanceTimersByTime(699);
    expect(onWarning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('touch() 重置 timer — 永不触发 timeout', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, onTimeout });
    wd.start();

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900);
      wd.touch();
    }
    // 总共 9000ms 但每 900ms touch 一次，永不撞 1000ms 上限
    expect(onTimeout).not.toHaveBeenCalled();

    // 停止 touch → 1001ms 后触发
    vi.advanceTimersByTime(1001);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('warning 一次性触发 — touch 重置后再次允许触发', () => {
    const onWarning = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, warningRatio: 0.7, onWarning, onTimeout: () => {} });
    wd.start();

    vi.advanceTimersByTime(701);
    expect(onWarning).toHaveBeenCalledTimes(1);

    // 同一周期再走也不会重复触发（warning timer 已 fire 过）
    vi.advanceTimersByTime(50);
    expect(onWarning).toHaveBeenCalledTimes(1);

    // touch → 重置；再次撞阈值时再次触发
    wd.touch();
    vi.advanceTimersByTime(701);
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  it('pause() 期间不算 idle，resume() 后从头计时', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, onTimeout });
    wd.start();

    vi.advanceTimersByTime(500);
    wd.pause();

    // pause 期间走 10000ms 也不会超时
    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();

    wd.resume();
    // resume 后 999ms 仍不撞墙（重新计时）
    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('stop() 后 touch 不再 arm', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, onTimeout });
    wd.start();
    wd.stop();
    wd.touch();

    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('onTimeout 触发后自动停止 — 不会重复触发', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, onTimeout });
    wd.start();
    vi.advanceTimersByTime(1001);
    expect(onTimeout).toHaveBeenCalledOnce();

    // 后续 touch / 时间推进都不再触发
    wd.touch();
    vi.advanceTimersByTime(10000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('warningRatio=0 → 不安排 warning', () => {
    const onWarning = vi.fn();
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, warningRatio: 0, onWarning, onTimeout });
    wd.start();
    vi.advanceTimersByTime(1001);
    expect(onWarning).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('未提供 onWarning → 不安排 warning timer', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({ idleMs: 1000, warningRatio: 0.5, onTimeout });
    wd.start();
    vi.advanceTimersByTime(501);
    // 没传 onWarning，只检查不抛错；timeout 仍正常
    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('onWarning 抛错 — 不影响后续 timeout 触发', () => {
    const onTimeout = vi.fn();
    const wd = new IdleWatchdog({
      idleMs: 1000,
      warningRatio: 0.5,
      onWarning: () => { throw new Error('boom'); },
      onTimeout,
    });
    wd.start();
    vi.advanceTimersByTime(1001);
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
