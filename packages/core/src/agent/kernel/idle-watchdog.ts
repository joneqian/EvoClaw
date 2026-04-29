/**
 * IdleWatchdog — 活动重置型超时（参考 OpenClaw llm-idle-timeout.ts）
 *
 * 设计目标：替代"总时长一刀切"的 wallclock 超时。
 *
 * 工作原理：
 *   - start() 后安排一个 timeout 定时器（默认 120s）+ 一个 warning 定时器（默认 70% × idleMs = 84s）
 *   - 每次活动事件（stream chunk / tool_end / 任意 progress）调 touch() 重置定时器
 *   - 连续 idleMs 没有 touch → onTimeout 触发
 *   - 连续 warningRatio × idleMs 没有 touch → onWarning 触发一次（不重复）
 *
 * 兼容 compaction：
 *   - pause() 暂停定时器（不算 idle）；resume() 重新 arm
 *
 * 不重复警告：
 *   - 每次 touch() 复位 warningFired，重新允许触发
 *   - 但**同一周期内**只触发一次（避免每帧重复发警告）
 */

import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('idle-watchdog');

export interface IdleWatchdogOpts {
  /** 完整 idle 阈值（毫秒） — 默认 120_000 (120s) */
  idleMs: number;
  /** 警告阈值比例（0~1） — 默认 0.7 (84s) */
  warningRatio?: number;
  /** 警告回调（一次性，每个周期最多一次） */
  onWarning?: (idleMsElapsed: number, idleMsTotal: number) => void;
  /** 超时回调（触发后定时器自动停止） */
  onTimeout: (idleMsTotal: number) => void;
}

export class IdleWatchdog {
  private warningTimer?: ReturnType<typeof setTimeout>;
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  private warningFired = false;
  private stopped = false;
  private paused = false;
  private _timedOut = false;

  private readonly idleMs: number;
  private readonly warningMs: number;
  private readonly onWarning?: (elapsedMs: number, totalMs: number) => void;
  private readonly onTimeout: (totalMs: number) => void;

  constructor(opts: IdleWatchdogOpts) {
    this.idleMs = opts.idleMs;
    const ratio = opts.warningRatio ?? 0.7;
    this.warningMs = Math.floor(this.idleMs * ratio);
    this.onWarning = opts.onWarning;
    this.onTimeout = opts.onTimeout;
  }

  /** 是否已经因超时被触发过 */
  get timedOut(): boolean {
    return this._timedOut;
  }

  /** 启动定时器（首次调用） */
  start(): void {
    if (this.stopped) return;
    log.debug(`arm idleMs=${this.idleMs} warningMs=${this.warningMs}`);
    this.arm();
  }

  /** 重置定时器（每次活动调用） */
  touch(): void {
    if (this.stopped || this.paused) return;
    this.clearTimers();
    this.warningFired = false;
    this.arm();
  }

  /** 暂停（compaction 期间） */
  pause(): void {
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.clearTimers();
    log.debug('pause (compaction)');
  }

  /** 恢复（compaction 结束） */
  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    this.warningFired = false;
    this.arm();
    log.debug('resume');
  }

  /** 永久停止（attempt 退出） */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
  }

  // ─── 内部 ────────────────────────────────────────

  private arm(): void {
    if (this.warningMs > 0 && this.onWarning && !this.warningFired) {
      this.warningTimer = setTimeout(() => {
        this.warningTimer = undefined;
        if (this.stopped || this.paused || this.warningFired) return;
        this.warningFired = true;
        log.info(`warning fired (${this.warningMs / 1000}s)`);
        try {
          this.onWarning?.(this.warningMs, this.idleMs);
        } catch (err) {
          log.warn('onWarning 抛错（已忽略）', err);
        }
      }, this.warningMs);
    }

    this.timeoutTimer = setTimeout(() => {
      this.timeoutTimer = undefined;
      if (this.stopped || this.paused) return;
      this._timedOut = true;
      log.info(`timeout fired (${this.idleMs / 1000}s)`);
      try {
        this.onTimeout(this.idleMs);
      } catch (err) {
        log.warn('onTimeout 抛错（已忽略）', err);
      } finally {
        // 触发后自动停止，避免重复
        this.stopped = true;
      }
    }, this.idleMs);
  }

  private clearTimers(): void {
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = undefined;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
  }
}
