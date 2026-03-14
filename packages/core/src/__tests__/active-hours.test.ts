import { describe, it, expect } from 'vitest';
import { isInActiveHours, DEFAULT_ACTIVE_HOURS } from '../scheduler/active-hours.js';

describe('isInActiveHours', () => {
  it('默认时段内应返回 true', () => {
    const noon = new Date('2026-03-14T12:00:00');
    expect(isInActiveHours(DEFAULT_ACTIVE_HOURS, noon)).toBe(true);
  });

  it('默认时段外应返回 false', () => {
    const midnight = new Date('2026-03-14T03:00:00');
    expect(isInActiveHours(DEFAULT_ACTIVE_HOURS, midnight)).toBe(false);
  });

  it('边界 start 应返回 true', () => {
    const atStart = new Date('2026-03-14T08:00:00');
    expect(isInActiveHours(DEFAULT_ACTIVE_HOURS, atStart)).toBe(true);
  });

  it('边界 end 应返回 false', () => {
    const atEnd = new Date('2026-03-14T22:00:00');
    expect(isInActiveHours(DEFAULT_ACTIVE_HOURS, atEnd)).toBe(false);
  });

  it('跨午夜时段 — 夜间应返回 true', () => {
    const config = { start: '22:00', end: '06:00' };
    const lateNight = new Date('2026-03-14T23:30:00');
    expect(isInActiveHours(config, lateNight)).toBe(true);
  });

  it('跨午夜时段 — 白天应返回 false', () => {
    const config = { start: '22:00', end: '06:00' };
    const afternoon = new Date('2026-03-14T15:00:00');
    expect(isInActiveHours(config, afternoon)).toBe(false);
  });
});
