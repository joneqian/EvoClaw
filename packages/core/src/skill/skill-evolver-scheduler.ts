/**
 * Skill Evolver Scheduler — M7 Phase 3
 *
 * 系统级后台调度器（非 agent 级），独立于 CronRunner。
 * - 每分钟 tick() 检查 cronSchedule 是否命中当前时间
 * - 命中 → runEvolutionCycle()
 * - 不重复触发：记录 lastRunKey（按 `YYYY-MM-DDTHH:MM` 标记，同一分钟只跑一次）
 *
 * 注意：本调度器在独立的 cron context 运行，**不注入 invoke_skill / skill_manage 工具**，
 * 避免 Evolver 产出 skill 后立刻执行形成进化循环。
 */

import cronParser from 'cron-parser';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { runEvolutionCycle, type LLMCallFn, type SkillEvolverConfig } from './skill-evolver.js';

const log = createLogger('skill-evolver-scheduler');

export interface SkillEvolverSchedulerOptions {
  db: SqliteStore;
  userSkillsDir: string;
  /** 配置 getter —— 支持热重载 */
  getConfig: () => SkillEvolverConfig | undefined;
  /** LLM 调用函数 getter —— 运行时解析（ModelRouter 可能还没 ready） */
  getLLMCall: () => LLMCallFn | undefined;
}

/** Scheduler 控制句柄 */
export class SkillEvolverScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunKey: string | null = null;
  private isRunning = false;

  constructor(private opts: SkillEvolverSchedulerOptions) {}

  /** 启动（每 60s 检查一次） */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 60_000);
    // 启动即 tick 一次
    this.tick();
    log.info('SkillEvolverScheduler started');
  }

  /** 停止 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('SkillEvolverScheduler stopped');
  }

  /** 手动触发一次（测试 / CLI 用） */
  async triggerNow(): Promise<void> {
    await this.runOnce(new Date());
  }

  private async tick(): Promise<void> {
    const config = this.opts.getConfig();
    if (!config || !config.enabled) return;

    const now = new Date();
    // 判断当前分钟是否命中 cronSchedule（回看到上一次触发点）
    let prev: Date;
    try {
      const iter = cronParser.parseExpression(config.cronSchedule, {
        currentDate: new Date(now.getTime() + 1),   // +1ms 让 prev 能取到本分钟
      });
      prev = iter.prev().toDate();
    } catch (err) {
      log.warn(`cronSchedule 解析失败: ${config.cronSchedule}`, { err: String(err) });
      return;
    }

    // 本分钟窗口：prev 在过去 60s 内
    if (now.getTime() - prev.getTime() > 60_000) return;

    // 去重 key（精确到分钟）
    const runKey = prev.toISOString().slice(0, 16);   // "YYYY-MM-DDTHH:MM"
    if (this.lastRunKey === runKey) return;
    this.lastRunKey = runKey;

    await this.runOnce(now);
  }

  private async runOnce(_now: Date): Promise<void> {
    if (this.isRunning) {
      log.warn('evolution cycle 正在运行，跳过本次触发');
      return;
    }
    const config = this.opts.getConfig();
    if (!config) return;
    const llmCall = this.opts.getLLMCall();
    if (!llmCall) {
      log.warn('LLM call function 未就绪，跳过 evolution cycle');
      return;
    }

    this.isRunning = true;
    try {
      const result = await runEvolutionCycle({
        db: this.opts.db,
        userSkillsDir: this.opts.userSkillsDir,
        config,
        llmCall,
      });
      log.info('evolution cycle finished', { ...result });
    } catch (err) {
      log.warn('runEvolutionCycle 顶层异常', { err: String(err) });
    } finally {
      this.isRunning = false;
    }
  }
}
