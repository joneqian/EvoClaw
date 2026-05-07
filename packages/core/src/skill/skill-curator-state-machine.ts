/**
 * Skill Curator 状态机 — 自动转换 active / stale / archived
 *
 * 灵感来自 Hermes `apply_automatic_transitions()`。
 *
 * 转换规则（每 7 天 tick 一次）：
 *   - 每个 agent-created skill 的 anchor = max(skill_usage.invoked_at) ?? manifest.createdAt
 *   - anchor < now - archivedDays (90d) AND state != 'archived' → archive (物理 mv)
 *   - anchor < now - staleDays (30d)   AND state == 'active'    → setState('stale')
 *   - anchor > now - staleDays         AND state == 'stale'     → setState('active') 反激活
 *   - pinned 全跳过
 *
 * 仅处理 source='agent-created' 的 skill（manifest 过滤）：
 *   - bundled / clawhub / github / local 永远不动（用户装的 / 用户手写）
 */

import path from 'node:path';
import fs from 'node:fs';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { readManifest, type SkillManifestEntry } from './skill-manifest.js';
import {
  archiveSkill,
  getEntry,
  setState,
} from './skill-curator-lifecycle.js';

const log = createLogger('skill-curator-state-machine');

/** 默认阈值（参考 Hermes，3 个决策已 user OK） */
export const DEFAULT_STALE_DAYS = 30;
export const DEFAULT_ARCHIVED_DAYS = 90;

/** Skill 数据库行：用于 MAX(invoked_at) 查询 */
interface LastInvokedRow {
  lastInvokedAt: string | null;
}

export interface ApplyTransitionsOptions {
  /** SQLite store（查 skill_usage 的 lastInvokedAt） */
  db: SqliteStore;
  /** Skill 根目录（manifest + .archive/ 都在这里） */
  userSkillsDir: string;
  /** 阈值：未用 N 天 → stale，默认 30 */
  staleDays?: number;
  /** 阈值：未用 N 天 → archived，默认 90 */
  archivedDays?: number;
  /** 注入的当前时间（测试用） */
  now?: Date;
}

export interface ApplyTransitionsResult {
  /** 检查的 agent-created skill 总数 */
  checked: number;
  /** active → stale 的数量 */
  markedStale: number;
  /** anchor 重回 30d 内 → 反激活的数量 */
  reactivated: number;
  /** 物理归档（移到 .archive/）的数量 */
  archived: number;
  /** 被跳过的 pinned 数量 */
  skippedPinned: number;
  /** 错误（不阻塞主流程） */
  errors: string[];
}

/**
 * 扫描所有 agent-created skill，按 last_activity 时间戳决定转移。
 * 返回汇总计数（不抛异常，错误进 errors）。
 */
export function applyAutomaticTransitions(opts: ApplyTransitionsOptions): ApplyTransitionsResult {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const archivedDays = opts.archivedDays ?? DEFAULT_ARCHIVED_DAYS;
  const staleCutoff = now.getTime() - staleDays * 86400_000;
  const archiveCutoff = now.getTime() - archivedDays * 86400_000;

  const result: ApplyTransitionsResult = {
    checked: 0,
    markedStale: 0,
    reactivated: 0,
    archived: 0,
    skippedPinned: 0,
    errors: [],
  };

  // 1) 列 agent-created skill
  const manifest = readManifest(opts.userSkillsDir);
  const agentCreated: SkillManifestEntry[] = [];
  for (const entry of manifest.values()) {
    if (entry.source === 'agent-created') agentCreated.push(entry);
  }

  log.info(`[transitions][start] candidates=${agentCreated.length} staleDays=${staleDays} archivedDays=${archivedDays}`);

  // 2) 逐个判断
  for (const entry of agentCreated) {
    result.checked++;
    try {
      const lifecycle = getEntry(entry.name, opts.userSkillsDir);
      if (lifecycle.pinned) {
        result.skippedPinned++;
        continue;
      }

      const anchor = computeActivityAnchor(opts.db, entry, opts.userSkillsDir);

      // archive：anchor 早于 90d 之前
      if (anchor.getTime() <= archiveCutoff && lifecycle.state !== 'archived') {
        const r = archiveSkill(entry.name, opts.userSkillsDir);
        if (r.ok) {
          result.archived++;
          log.info(`[archive] ${entry.name} (anchor=${anchor.toISOString()})`);
        } else {
          result.errors.push(`archive ${entry.name}: ${r.message}`);
        }
        continue;
      }

      // stale：active 但 anchor 早于 30d 前
      if (anchor.getTime() <= staleCutoff && lifecycle.state === 'active') {
        setState(entry.name, 'stale', opts.userSkillsDir);
        result.markedStale++;
        log.info(`[stale] ${entry.name} (anchor=${anchor.toISOString()})`);
        continue;
      }

      // reactivation：stale 但 anchor 重新进入 30d 内（说明 skill 又被用了）
      if (anchor.getTime() > staleCutoff && lifecycle.state === 'stale') {
        setState(entry.name, 'active', opts.userSkillsDir);
        result.reactivated++;
        log.info(`[reactivate] ${entry.name} (anchor=${anchor.toISOString()})`);
        continue;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${entry.name}: ${msg}`);
      log.warn(`[transitions][error] ${entry.name}: ${msg}`);
    }
  }

  log.info(`[transitions][done] checked=${result.checked} stale=${result.markedStale} reactivated=${result.reactivated} archived=${result.archived} pinned=${result.skippedPinned} errors=${result.errors.length}`);
  return result;
}

/**
 * 计算 skill 的活动锚点时间：
 *   优先 skill_usage.MAX(invoked_at)
 *   回退 manifest.createdAt（避免新 skill 立即被归档）
 *   再回退 SKILL.md 的 mtime
 *   最后回退 epoch（极少触发）
 */
function computeActivityAnchor(
  db: SqliteStore,
  entry: SkillManifestEntry,
  userSkillsDir: string,
): Date {
  // 1. skill_usage MAX(invoked_at)
  try {
    const row = db.get<LastInvokedRow>(
      `SELECT MAX(invoked_at) AS lastInvokedAt FROM skill_usage WHERE skill_name = ?`,
      entry.name,
    );
    if (row?.lastInvokedAt) {
      return new Date(row.lastInvokedAt);
    }
  } catch {
    // skill_usage 表不存在或查询失败 → 走 manifest fallback
  }

  // 2. manifest createdAt
  if (entry.createdAt) {
    const d = new Date(entry.createdAt);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // 3. SKILL.md mtime
  try {
    const stat = fs.statSync(path.join(userSkillsDir, entry.name, 'SKILL.md'));
    return stat.mtime;
  } catch {
    // 文件不存在
  }

  // 4. epoch fallback（永远会被归档）
  return new Date(0);
}
