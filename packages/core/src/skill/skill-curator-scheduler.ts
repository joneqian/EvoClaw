/**
 * Skill Curator Scheduler — 每小时 tick 检查 7 天间隔，到期触发 curator review
 *
 * 独立于 SkillEvolverScheduler（cron evolver）：
 *   - cron evolver: 每分钟 tick，针对单 skill 看 stats 决策
 *   - curator: 每小时 tick 检查 N 天间隔，跨 session umbrella consolidation
 *
 * 灵感来自 Hermes maybe_run_curator（事件驱动）+ EvoClaw 的 setInterval pattern。
 *
 * 不阻塞调用方 — runOnce 内部 fire-and-forget，错误进 warn log。
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { AgentRunConfig } from '../agent/types.js';
import { createLogger } from '../infrastructure/logger.js';
import { runCuratorReview, type CuratorReviewResult } from './skill-curator.js';
import { shouldRunCurator } from './skill-curator-state.js';

const log = createLogger('skill-curator-scheduler');

/** 默认 tick 间隔：1 小时（intervalDays 是天级，分钟级精度无意义） */
const DEFAULT_TICK_INTERVAL_MS = 60 * 60 * 1000;

/** Curator 配置（与 security.skillCurator schema 对齐，scheduler 通过 getConfig 热重载读取） */
export interface SkillCuratorRuntimeConfig {
  enabled: boolean;
  intervalDays: number;
  staleDays: number;
  archivedDays: number;
  protectBundled: boolean;
}

/** 默认值（与 schema 对齐；schema 未配置或 ConfigManager 未注入时兜底） */
const DEFAULT_RUNTIME_CONFIG: SkillCuratorRuntimeConfig = {
  enabled: false,
  intervalDays: 7,
  staleDays: 30,
  archivedDays: 90,
  protectBundled: true,
};

export interface SkillCuratorSchedulerOptions {
  db: SqliteStore;
  userSkillsDir: string;
  /**
   * 配置 getter —— 支持热重载。返回 undefined 时走 DEFAULT_RUNTIME_CONFIG。
   * M7-Tier1 PR6 之前用构造时 intervalDays 硬编码；现在改成与 SkillEvolverScheduler
   * 相同的 getter 模式，让 SettingsPage 改完立即生效不重启。
   */
  getConfig?: () => Partial<SkillCuratorRuntimeConfig> | undefined;
  /**
   * AgentRunConfig getter — 运行时解析（避免启动时还没就绪）。
   * 返回 undefined → 跳过本次 tick（warn log 但不报错）。
   */
  getRunConfig: () => AgentRunConfig | undefined;
  /** tick 间隔（ms），默认 1 小时；测试可缩短 */
  tickIntervalMs?: number;
}

export class SkillCuratorScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(private opts: SkillCuratorSchedulerOptions) {}

  /** 解析当前生效配置（getConfig 返回的值与默认值合并；enabled=false 时调用方应短路） */
  private resolveConfig(): SkillCuratorRuntimeConfig {
    const partial = this.opts.getConfig?.() ?? {};
    return { ...DEFAULT_RUNTIME_CONFIG, ...partial };
  }

  start(): void {
    if (this.timer) return;
    const interval = this.opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.timer = setInterval(() => { void this.tick(); }, interval);
    const cfg = this.resolveConfig();
    log.info(`SkillCuratorScheduler started (enabled=${cfg.enabled} intervalDays=${cfg.intervalDays} tickMs=${interval})`);
    // 启动后异步 tick 一次（不阻塞 boot）
    setImmediate(() => { void this.tick(); });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('SkillCuratorScheduler stopped');
  }

  /** 手动触发一次（REST /curator/run + 测试用）。dryRun 可选；不受 enabled 门控（手动操作）。 */
  async triggerNow(options?: { dryRun?: boolean }): Promise<CuratorReviewResult | { skipped: true; reason: string }> {
    return await this.runOnce(options ?? {});
  }

  private async tick(): Promise<void> {
    const cfg = this.resolveConfig();
    if (!cfg.enabled) {
      log.debug('tick skip: enabled=false');
      return;
    }
    const sched = shouldRunCurator({
      intervalDays: cfg.intervalDays,
      skillsBaseDir: this.opts.userSkillsDir,
    });
    if (!sched.shouldRun) {
      log.debug(`tick skip: ${sched.reason}`);
      return;
    }
    log.info(`tick fire: ${sched.reason}`);
    await this.runOnce({ dryRun: false });
  }

  private async runOnce(options: { dryRun?: boolean }): Promise<CuratorReviewResult | { skipped: true; reason: string }> {
    if (this.isRunning) {
      log.warn('curator review 正在运行，跳过本次触发');
      return { skipped: true, reason: 'already-running' };
    }
    const parentConfig = this.opts.getRunConfig();
    if (!parentConfig) {
      log.warn('AgentRunConfig 未就绪（无 active agent / LLM provider 未配），跳过本次');
      return { skipped: true, reason: 'no-agent-run-config' };
    }

    this.isRunning = true;
    try {
      const cfg = this.resolveConfig();
      return await runCuratorReview({
        parentConfig,
        userSkillsDir: this.opts.userSkillsDir,
        db: this.opts.db,
        dryRun: options.dryRun ?? false,
        staleDays: cfg.staleDays,
        archivedDays: cfg.archivedDays,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
