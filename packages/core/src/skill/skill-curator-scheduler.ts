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

export interface SkillCuratorSchedulerOptions {
  db: SqliteStore;
  userSkillsDir: string;
  /** 触发间隔（天），默认 7 */
  intervalDays?: number;
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
  private intervalDays: number;

  constructor(private opts: SkillCuratorSchedulerOptions) {
    this.intervalDays = opts.intervalDays ?? 7;
  }

  start(): void {
    if (this.timer) return;
    const interval = this.opts.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.timer = setInterval(() => { void this.tick(); }, interval);
    log.info(`SkillCuratorScheduler started (intervalDays=${this.intervalDays}, tickMs=${interval})`);
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

  /** 手动触发一次（REST /curator/run + 测试用）。dryRun 可选。 */
  async triggerNow(options?: { dryRun?: boolean }): Promise<CuratorReviewResult | { skipped: true; reason: string }> {
    return await this.runOnce(options ?? {});
  }

  private async tick(): Promise<void> {
    const sched = shouldRunCurator({
      intervalDays: this.intervalDays,
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
      return await runCuratorReview({
        parentConfig,
        userSkillsDir: this.opts.userSkillsDir,
        db: this.opts.db,
        dryRun: options.dryRun ?? false,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
