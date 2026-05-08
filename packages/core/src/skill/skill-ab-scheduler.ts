/**
 * Skill A-B 评估器调度器 — M7-Tier3 PR-T3-1b
 *
 * 与 SkillEvolverScheduler 同模式（每 60s tick 检查 cron 表达式），但跑评估器
 * 而不是 evolver。默认错峰 04:30（evolver 03:00 + curator 4 小时间隔），让 evolver
 * 先跑完才进 A-B。
 *
 * 与 SkillCuratorScheduler 不同：评估器没有 enabled toggle —— 一旦有 active A-B
 * 测试就必须能评估到（否则会永远 active）。如果用户彻底想关 A-B，应该把
 * skillEvolver.abTestEnabled 关掉，让新 refine 不再启动 A-B；现有 active 测试
 * 仍会被本调度器评估完。
 */

import { CronExpressionParser } from 'cron-parser';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { runEvaluatorCycle, type AbEvaluatorConfig, type EvaluatorCycleResult } from './skill-ab-evaluator.js';

const log = createLogger('skill-ab-scheduler');

export interface SkillAbEvaluatorSchedulerOptions {
  db: SqliteStore;
  userSkillsDir: string;
  /** Cron 表达式 getter；返回 undefined 时用 DEFAULT_CRON */
  getCronSchedule?: () => string | undefined;
  /** 评估器阈值 getter */
  getConfig?: () => Partial<AbEvaluatorConfig> | undefined;
}

const DEFAULT_CRON = '30 4 * * *';
const TICK_INTERVAL_MS = 60_000;

export class SkillAbEvaluatorScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunKey: string | null = null;
  private isRunning = false;

  constructor(private opts: SkillAbEvaluatorSchedulerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, TICK_INTERVAL_MS);
    void this.tick();
    log.info('SkillAbEvaluatorScheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('SkillAbEvaluatorScheduler stopped');
  }

  /** 手动触发一次（REST + 测试用）。dryRun 由调用方在 config 中控制。 */
  async triggerNow(): Promise<EvaluatorCycleResult> {
    return await this.runOnce();
  }

  private async tick(): Promise<void> {
    const cronSchedule = this.opts.getCronSchedule?.() ?? DEFAULT_CRON;
    const now = new Date();
    let prev: Date;
    try {
      const iter = CronExpressionParser.parse(cronSchedule, {
        currentDate: new Date(now.getTime() + 1),
      });
      prev = iter.prev().toDate();
    } catch (err) {
      log.warn(`cronSchedule 解析失败: ${cronSchedule}`, { err: String(err) });
      return;
    }
    if (now.getTime() - prev.getTime() > TICK_INTERVAL_MS) return;

    const runKey = prev.toISOString().slice(0, 16);
    if (this.lastRunKey === runKey) return;
    this.lastRunKey = runKey;

    await this.runOnce();
  }

  private async runOnce(): Promise<EvaluatorCycleResult> {
    if (this.isRunning) {
      log.warn('evaluator cycle 正在运行，跳过本次触发');
      return { scanned: 0, promoted: 0, rolledBack: 0, inconclusive: 0, continued: 0, errors: 0 };
    }
    this.isRunning = true;
    try {
      const partial = this.opts.getConfig?.() ?? {};
      const result = await runEvaluatorCycle({
        db: this.opts.db,
        userSkillsDir: this.opts.userSkillsDir,
        ...(Object.keys(partial).length > 0 ? { config: { ...DEFAULTS, ...partial } } : {}),
      });
      return result;
    } finally {
      this.isRunning = false;
    }
  }
}

import { DEFAULT_AB_EVALUATOR_CONFIG as DEFAULTS } from './skill-ab-evaluator.js';
