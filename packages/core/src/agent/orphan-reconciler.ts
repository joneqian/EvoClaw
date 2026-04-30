/**
 * Agent 工作区孤儿目录扫描 & 隔离
 *
 * 用途：周期性比对 agents/ 顶层目录与 agents 表，把"在文件系统但不在 DB"的目录
 * 隔离到 agents/_orphan/<uuid>-<ts>/，防止 LLM hallucinate UUID 写入的影子目录
 * 长期堆积。
 *
 * 设计原则：
 * - **永不 rm**：只做 rename → _orphan/，写一份 manifest.json，留 30 天后再由独立任务清理
 * - **新生效宽限期**：mtime < 24h 的孤儿仅日志告警，不移动（防误伤 createAgent in-flight 时序）
 * - **管理目录例外**：跳过 _orphan、by-name、隐藏文件
 * - **审计可追**：每次隔离写一条 audit_log（action='orphan_isolated'）
 *
 * 触发：sidecar 启动后 30 秒做一次 + 每 24h 跑一次。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('orphan-reconciler');

/** 默认扫描间隔：24h */
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 启动后首次扫描延迟：30s（避免拖慢冷启） */
const DEFAULT_BOOT_DELAY_MS = 30_000;

/** mtime 宽限期：< 24h 的孤儿不移动（防 createAgent in-flight 时序误伤） */
const FRESH_GRACE_MS = 24 * 60 * 60 * 1000;

/** 每个 manifest 收集的 sample 文件数上限 */
const MANIFEST_SAMPLE_LIMIT = 50;

/** 跳过的管理目录 / 隐藏文件 */
const RESERVED_DIRS = new Set(['_orphan', 'by-name']);

/** 单次扫描的报告 */
export interface OrphanReport {
  scanned: number;
  /** 命中的孤儿目录（含未达宽限期的） */
  orphans: OrphanEntry[];
  /** 实际已隔离到 _orphan/ 的目录 */
  isolated: IsolatedEntry[];
  /** 因宽限期跳过的目录（mtime < 24h） */
  skippedFresh: OrphanEntry[];
}

/** 孤儿条目元数据 */
export interface OrphanEntry {
  uuid: string;
  absPath: string;
  mtimeMs: number;
  fileCount: number;
  sample: string[];
}

/** 已隔离条目（含目标路径） */
export interface IsolatedEntry extends OrphanEntry {
  isolatedTo: string;
}

/** reconcile 选项 */
export interface ReconcileOptions {
  /** dryRun=true 仅扫描+报告，不移动文件、不写 audit */
  dryRun?: boolean;
  /** 覆盖默认宽限期（仅测试用） */
  freshGraceMs?: number;
}

/**
 * 单次执行：扫描 → 分类 → 隔离
 */
export function reconcileOrphans(
  store: SqliteStore,
  agentsBaseDir: string,
  options: ReconcileOptions = {},
): OrphanReport {
  const { dryRun = false, freshGraceMs = FRESH_GRACE_MS } = options;
  const report: OrphanReport = {
    scanned: 0,
    orphans: [],
    isolated: [],
    skippedFresh: [],
  };

  if (!fs.existsSync(agentsBaseDir)) {
    return report;
  }

  // 一次性把 agents 表的 id 拉到内存（数量 = agent 数量，通常 < 1000）
  const knownIds = new Set(
    store.all<{ id: string }>('SELECT id FROM agents').map(r => r.id),
  );

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsBaseDir, { withFileTypes: true });
  } catch (err) {
    log.warn('扫描 agentsBaseDir 失败', { agentsBaseDir, err: errorMessage(err) });
    return report;
  }

  const now = Date.now();
  const orphanRoot = path.join(agentsBaseDir, '_orphan');

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (RESERVED_DIRS.has(entry.name)) continue;

    report.scanned++;

    if (knownIds.has(entry.name)) continue;

    const absPath = path.join(agentsBaseDir, entry.name);
    const meta = collectOrphanMeta(entry.name, absPath);
    report.orphans.push(meta);

    // 宽限期：刚创建 < 24h 的目录不动，防止 createAgent / deleteAgent 时序误判
    // Math.max(0, ...) 抹掉时钟精度差导致的伪负数（Date.now() 是整数 ms，stat.mtimeMs 是亚毫秒）
    const ageMs = Math.max(0, now - meta.mtimeMs);
    if (ageMs < freshGraceMs) {
      report.skippedFresh.push(meta);
      log.warn('孤儿目录命中宽限期，仅记录不隔离', {
        uuid: meta.uuid,
        mtimeMs: meta.mtimeMs,
        fileCount: meta.fileCount,
      });
      continue;
    }

    if (dryRun) {
      // 干跑：只生成报告，不动磁盘、不写 audit
      report.isolated.push({ ...meta, isolatedTo: '<dry-run>' });
      continue;
    }

    const isolatedTo = isolateOrphan(meta, orphanRoot);
    if (isolatedTo) {
      report.isolated.push({ ...meta, isolatedTo });
      try {
        store.run(
          'INSERT INTO audit_log (action, details) VALUES (?, ?)',
          'orphan_isolated',
          JSON.stringify({
            uuid: meta.uuid,
            from: absPath,
            to: isolatedTo,
            mtimeMs: meta.mtimeMs,
            fileCount: meta.fileCount,
            sample: meta.sample,
          }),
        );
      } catch (err) {
        log.warn('audit_log 写入失败（不影响隔离结果）', { err: errorMessage(err) });
      }
      log.info('孤儿目录已隔离', { uuid: meta.uuid, isolatedTo });
    }
  }

  return report;
}

/** 收集孤儿目录元数据 */
function collectOrphanMeta(uuid: string, absPath: string): OrphanEntry {
  const sample: string[] = [];
  let fileCount = 0;
  let latestMtimeMs = 0;

  try {
    const stat = fs.statSync(absPath);
    latestMtimeMs = stat.mtimeMs;
  } catch {
    // 读不到 stat，留 0
  }

  // 浅扫一级；不递归全树（避免大目录拖慢 reconcile）
  walkLimited(absPath, sample, latestMtimeMs, (count, mtime) => {
    fileCount += count;
    if (mtime > latestMtimeMs) latestMtimeMs = mtime;
  });

  return {
    uuid,
    absPath,
    mtimeMs: latestMtimeMs,
    fileCount,
    sample: sample.slice(0, MANIFEST_SAMPLE_LIMIT),
  };
}

/** 浅遍历，收集前 50 个文件名 + 累计 fileCount + 最新 mtime */
function walkLimited(
  dir: string,
  sample: string[],
  initialMtime: number,
  onSummary: (count: number, mtime: number) => void,
): void {
  let count = 0;
  let latestMtime = initialMtime;
  try {
    const stack: string[] = [dir];
    while (stack.length > 0 && sample.length < MANIFEST_SAMPLE_LIMIT * 2) {
      const cur = stack.pop()!;
      let kids: fs.Dirent[];
      try {
        kids = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const kid of kids) {
        const full = path.join(cur, kid.name);
        if (kid.isDirectory()) {
          stack.push(full);
        } else if (kid.isFile()) {
          count++;
          if (sample.length < MANIFEST_SAMPLE_LIMIT) {
            sample.push(path.relative(dir, full));
          }
          try {
            const st = fs.statSync(full);
            if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
          } catch {
            // ignore
          }
        }
      }
    }
  } finally {
    onSummary(count, latestMtime);
  }
}

/** 把孤儿目录 mv 到 _orphan/，写 manifest.json */
function isolateOrphan(meta: OrphanEntry, orphanRoot: string): string | null {
  try {
    fs.mkdirSync(orphanRoot, { recursive: true });
  } catch (err) {
    log.warn('创建 _orphan 根目录失败', { orphanRoot, err: errorMessage(err) });
    return null;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const targetName = `${meta.uuid}-${ts}`;
  const target = path.join(orphanRoot, targetName);

  try {
    fs.renameSync(meta.absPath, target);
  } catch (err) {
    log.warn('rename 失败（跨设备？）', { from: meta.absPath, to: target, err: errorMessage(err) });
    return null;
  }

  // 写 manifest.json（隔离条目自描述，便于事后审计）
  try {
    const manifest = {
      uuid: meta.uuid,
      isolatedAt: new Date().toISOString(),
      originalPath: meta.absPath,
      mtimeMs: meta.mtimeMs,
      mtimeIso: new Date(meta.mtimeMs).toISOString(),
      fileCount: meta.fileCount,
      sample: meta.sample,
    };
    fs.writeFileSync(
      path.join(target, '_orphan_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
  } catch (err) {
    // manifest 写失败不影响隔离已完成
    log.warn('manifest 写入失败（已完成隔离）', { err: errorMessage(err) });
  }

  return target;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ───────────────────────────────────────────────────────────────────────────
// 调度器
// ───────────────────────────────────────────────────────────────────────────

/**
 * 孤儿目录扫描调度器
 *
 * 启动：sidecar 起 30 秒后做一次扫描；之后每 24h 一次。
 * 关闭：与 server.ts 的 shutdown handler 链联动。
 */
export class OrphanReconcilerScheduler {
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: SqliteStore,
    private readonly agentsBaseDir: string,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
    private readonly bootDelayMs: number = DEFAULT_BOOT_DELAY_MS,
  ) {}

  start(): void {
    if (this.bootTimer || this.intervalTimer) return;
    this.bootTimer = setTimeout(() => {
      this.bootTimer = null;
      this.tickSafe();
      this.intervalTimer = setInterval(() => this.tickSafe(), this.intervalMs);
    }, this.bootDelayMs);
  }

  stop(): void {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /** 同步执行一次扫描，吞异常防止 setInterval 死掉 */
  private tickSafe(): void {
    try {
      const report = reconcileOrphans(this.store, this.agentsBaseDir);
      if (report.isolated.length > 0 || report.skippedFresh.length > 0) {
        log.info('orphan reconcile 完成', {
          scanned: report.scanned,
          isolated: report.isolated.length,
          skippedFresh: report.skippedFresh.length,
        });
      }
    } catch (err) {
      log.warn('orphan reconcile 失败', { err: errorMessage(err) });
    }
  }
}
