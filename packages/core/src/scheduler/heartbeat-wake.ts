/**
 * Heartbeat Wake 合并器
 *
 * 将短时间内的多个唤醒请求合并为单次执行，
 * 防止 Cron 事件 + 手动唤醒 + 定时触发同时命中导致重复 LLM 调用。
 */
import type { HeartbeatReason } from './heartbeat-prompts.js';

/** 唤醒优先级（数字越大优先级越高） */
export const WakePriority = {
  RETRY: 0,
  INTERVAL: 1,
  DEFAULT: 2,
  ACTION: 3,
} as const;

export type WakePriorityValue = (typeof WakePriority)[keyof typeof WakePriority];

interface PendingWake {
  reason: HeartbeatReason;
  priority: WakePriorityValue;
}

/** 默认合并窗口 (ms) */
const DEFAULT_COALESCE_MS = 250;

export class HeartbeatWakeCoalescer {
  private pending: PendingWake | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onWake: (reason: HeartbeatReason) => Promise<void>,
    private readonly coalesceMs = DEFAULT_COALESCE_MS,
  ) {}

  /**
   * 请求唤醒
   *
   * 在合并窗口内：保留最高优先级的请求。
   * 窗口结束后执行一次。
   */
  request(reason: HeartbeatReason, priority: WakePriorityValue): void {
    if (this.pending && this.pending.priority >= priority) {
      return; // 已有更高或相同优先级的请求
    }

    this.pending = { reason, priority };

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.coalesceMs);
    }
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const wake = this.pending;
    this.pending = null;

    if (wake) {
      await this.onWake(wake.reason);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }
}
