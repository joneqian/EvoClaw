/**
 * skill-curator-state 单测
 *
 * 验证 .curator_state.json 序列化往返 + shouldRunCurator 间隔判断。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  readCuratorState,
  writeCuratorState,
  updateCuratorState,
  shouldRunCurator,
} from '../../skill/skill-curator-state.js';

describe('skill-curator-state', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-state-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('文件不存在 → 返回默认值', () => {
    const s = readCuratorState(tmpDir);
    expect(s.lastRunAt).toBeNull();
    expect(s.runCount).toBe(0);
    expect(s.paused).toBe(false);
  });

  it('write + read 往返', () => {
    const ts = new Date().toISOString();
    writeCuratorState({
      version: 1,
      lastRunAt: ts,
      lastRunSummary: 'reviewed 3 skills',
      lastRunDurationMs: 5000,
      paused: false,
      runCount: 7,
    }, tmpDir);

    const r = readCuratorState(tmpDir);
    expect(r.lastRunAt).toBe(ts);
    expect(r.runCount).toBe(7);
    expect(r.lastRunSummary).toBe('reviewed 3 skills');
  });

  it('updateCuratorState 部分更新（merge）', () => {
    writeCuratorState({
      version: 1, lastRunAt: '2026-01-01T00:00:00Z', lastRunSummary: 'old',
      lastRunDurationMs: 1000, paused: false, runCount: 5,
    }, tmpDir);

    const next = updateCuratorState({ lastRunAt: '2026-05-07T00:00:00Z', runCount: 6 }, tmpDir);
    expect(next.lastRunAt).toBe('2026-05-07T00:00:00Z');
    expect(next.runCount).toBe(6);
    expect(next.lastRunSummary).toBe('old'); // 没改的字段保留
  });

  it('解析失败 → fail-soft 默认值', () => {
    fs.writeFileSync(path.join(tmpDir, '.curator_state.json'), 'bad-json{', 'utf-8');
    const s = readCuratorState(tmpDir);
    expect(s.lastRunAt).toBeNull();
  });

  it('version 不匹配 → fail-soft 默认值', () => {
    fs.writeFileSync(path.join(tmpDir, '.curator_state.json'),
      JSON.stringify({ version: 99, lastRunAt: 'x' }), 'utf-8');
    const s = readCuratorState(tmpDir);
    expect(s.lastRunAt).toBeNull();
  });

  describe('shouldRunCurator', () => {
    const NOW = new Date('2026-05-07T12:00:00Z');

    it('paused → 不跑', () => {
      writeCuratorState({
        version: 1, lastRunAt: null, lastRunSummary: null,
        lastRunDurationMs: null, paused: true, runCount: 0,
      }, tmpDir);
      const r = shouldRunCurator({ intervalDays: 7, now: NOW, skillsBaseDir: tmpDir });
      expect(r.shouldRun).toBe(false);
      expect(r.reason).toBe('paused');
    });

    it('lastRunAt = null → 第一次跑', () => {
      const r = shouldRunCurator({ intervalDays: 7, now: NOW, skillsBaseDir: tmpDir });
      expect(r.shouldRun).toBe(true);
      expect(r.reason).toBe('first-run');
    });

    it('距离上次 < interval → 不跑', () => {
      const lastRun = new Date(NOW.getTime() - 3 * 86400_000); // 3d 前
      writeCuratorState({
        version: 1, lastRunAt: lastRun.toISOString(), lastRunSummary: null,
        lastRunDurationMs: null, paused: false, runCount: 1,
      }, tmpDir);
      const r = shouldRunCurator({ intervalDays: 7, now: NOW, skillsBaseDir: tmpDir });
      expect(r.shouldRun).toBe(false);
      expect(r.reason).toMatch(/next-run-in/);
    });

    it('距离上次 >= interval → 跑', () => {
      const lastRun = new Date(NOW.getTime() - 8 * 86400_000); // 8d 前
      writeCuratorState({
        version: 1, lastRunAt: lastRun.toISOString(), lastRunSummary: null,
        lastRunDurationMs: null, paused: false, runCount: 5,
      }, tmpDir);
      const r = shouldRunCurator({ intervalDays: 7, now: NOW, skillsBaseDir: tmpDir });
      expect(r.shouldRun).toBe(true);
      expect(r.reason).toMatch(/elapsed=8d/);
    });

    it('lastRunAt 非法格式 → 跑（视为重置）', () => {
      writeCuratorState({
        version: 1, lastRunAt: 'not-a-date', lastRunSummary: null,
        lastRunDurationMs: null, paused: false, runCount: 0,
      }, tmpDir);
      const r = shouldRunCurator({ intervalDays: 7, now: NOW, skillsBaseDir: tmpDir });
      expect(r.shouldRun).toBe(true);
      expect(r.reason).toBe('invalid-last-run');
    });
  });
});
