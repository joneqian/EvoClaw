/**
 * Skill Curator 全局调度状态 — 跨 session 持久化 last_run_at / paused 等
 *
 * 文件位置：`~/.evoclaw/skills/.curator_state.json`
 * 格式：
 *   {
 *     "version": 1,
 *     "lastRunAt": "ISO-8601" | null,
 *     "lastRunSummary": "string" | null,
 *     "lastRunDurationMs": number | null,
 *     "paused": false,
 *     "runCount": number
 *   }
 *
 * 灵感来自 Hermes `~/.hermes/skills/.curator_state`。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-curator-state');

const FILENAME = '.curator_state.json';

export interface CuratorState {
  version: 1;
  lastRunAt: string | null;
  lastRunSummary: string | null;
  lastRunDurationMs: number | null;
  paused: boolean;
  runCount: number;
}

function defaultState(): CuratorState {
  return {
    version: 1,
    lastRunAt: null,
    lastRunSummary: null,
    lastRunDurationMs: null,
    paused: false,
    runCount: 0,
  };
}

function statePath(skillsBaseDir?: string): string {
  return path.join(
    skillsBaseDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills'),
    FILENAME,
  );
}

/** 读取状态。文件不存在 / 解析失败 → fail-soft 返回默认值。 */
export function readCuratorState(skillsBaseDir?: string): CuratorState {
  const filePath = statePath(skillsBaseDir);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CuratorState>;
    if (parsed.version !== 1) {
      log.warn(`curator state version=${parsed.version}，期望 1；返回默认值`);
      return defaultState();
    }
    return {
      version: 1,
      lastRunAt: parsed.lastRunAt ?? null,
      lastRunSummary: parsed.lastRunSummary ?? null,
      lastRunDurationMs: parsed.lastRunDurationMs ?? null,
      paused: Boolean(parsed.paused),
      runCount: typeof parsed.runCount === 'number' ? parsed.runCount : 0,
    };
  } catch (err) {
    log.warn(`curator state 解析失败（已忽略）: ${err instanceof Error ? err.message : String(err)}`);
    return defaultState();
  }
}

/** 原子写状态。 */
export function writeCuratorState(state: CuratorState, skillsBaseDir?: string): void {
  const filePath = statePath(skillsBaseDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // 忽略，让 writeFile 抛
  }

  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    log.warn(`curator state 写入失败: ${err instanceof Error ? err.message : String(err)}`);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** 部分更新（merge）。 */
export function updateCuratorState(
  patch: Partial<Omit<CuratorState, 'version'>>,
  skillsBaseDir?: string,
): CuratorState {
  const current = readCuratorState(skillsBaseDir);
  const next: CuratorState = {
    ...current,
    ...patch,
    version: 1,
  };
  writeCuratorState(next, skillsBaseDir);
  return next;
}

/** 判断当前是否到下一次 curator 运行的时间。 */
export function shouldRunCurator(opts: {
  intervalDays: number;
  now?: Date;
  skillsBaseDir?: string;
}): { shouldRun: boolean; reason: string; lastRunAt: string | null } {
  const state = readCuratorState(opts.skillsBaseDir);
  if (state.paused) {
    return { shouldRun: false, reason: 'paused', lastRunAt: state.lastRunAt };
  }
  if (!state.lastRunAt) {
    return { shouldRun: true, reason: 'first-run', lastRunAt: null };
  }
  const now = opts.now ?? new Date();
  const lastRunMs = Date.parse(state.lastRunAt);
  if (!Number.isFinite(lastRunMs)) {
    return { shouldRun: true, reason: 'invalid-last-run', lastRunAt: state.lastRunAt };
  }
  const elapsedMs = now.getTime() - lastRunMs;
  const intervalMs = opts.intervalDays * 86400_000;
  if (elapsedMs >= intervalMs) {
    return {
      shouldRun: true,
      reason: `elapsed=${Math.floor(elapsedMs / 86400_000)}d >= interval=${opts.intervalDays}d`,
      lastRunAt: state.lastRunAt,
    };
  }
  return {
    shouldRun: false,
    reason: `next-run-in=${Math.ceil((intervalMs - elapsedMs) / 86400_000)}d`,
    lastRunAt: state.lastRunAt,
  };
}
