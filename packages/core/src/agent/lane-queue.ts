import { LANE_CONCURRENCY } from '@evoclaw/shared';

export type LaneName = 'main' | 'subagent' | 'cron';

interface QueueItem<T> {
  id: string;
  sessionKey: string;
  lane: LaneName;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  abortController: AbortController;
  enqueuedAt: number;
  timeoutMs: number;
}

/**
 * Lane 队列 — 三车道并发控制
 * main / subagent / cron 各自独立的并发限制，同 sessionKey 串行执行
 */
export class LaneQueue {
  private queues: Map<LaneName, QueueItem<any>[]> = new Map();
  private running: Map<LaneName, Set<string>> = new Map();
  private runningKeys: Map<string, string> = new Map(); // sessionKey -> itemId（串行保障）
  private runningItems: Map<string, QueueItem<any>> = new Map(); // sessionKey -> 运行中的 item（用于 abortRunning）
  private concurrency: Record<LaneName, number>;

  constructor(concurrency?: Partial<Record<LaneName, number>>) {
    this.concurrency = {
      main: concurrency?.main ?? LANE_CONCURRENCY.main,
      subagent: concurrency?.subagent ?? LANE_CONCURRENCY.subagent,
      cron: concurrency?.cron ?? LANE_CONCURRENCY.cron,
    };
    for (const lane of ['main', 'subagent', 'cron'] as LaneName[]) {
      this.queues.set(lane, []);
      this.running.set(lane, new Set());
    }
  }

  /** 入队任务 */
  enqueue<T>(options: {
    id: string;
    sessionKey: string;
    lane: LaneName;
    task: () => Promise<T>;
    timeoutMs?: number;
    /** 外部 AbortController — 调用方可通过它取消运行中的任务 */
    abortController?: AbortController;
  }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id: options.id,
        sessionKey: options.sessionKey,
        lane: options.lane,
        task: options.task,
        resolve,
        reject,
        abortController: options.abortController ?? new AbortController(),
        enqueuedAt: Date.now(),
        timeoutMs: options.timeoutMs ?? 0, // 0 = 不超时；超时由 attempt 内的 IdleWatchdog + Wallclock 唯一负责（M13 重构）
      };
      this.queues.get(options.lane)!.push(item);
      this.drain(options.lane);
    });
  }

  /** 取消任务 */
  cancel(id: string): boolean {
    for (const [_lane, queue] of this.queues) {
      const idx = queue.findIndex(item => item.id === id);
      if (idx !== -1) {
        const [item] = queue.splice(idx, 1);
        item.reject(new Error('Task cancelled'));
        item.abortController.abort();
        return true;
      }
    }
    return false;
  }

  /** 中止正在运行的任务（按 sessionKey） */
  abortRunning(sessionKey: string): boolean {
    const item = this.runningItems.get(sessionKey);
    if (!item) return false;
    item.abortController.abort();
    return true;
  }

  /** 获取队列状态 */
  getStatus(): Record<LaneName, { running: number; queued: number; concurrency: number }> {
    const status = {} as Record<LaneName, { running: number; queued: number; concurrency: number }>;
    for (const lane of ['main', 'subagent', 'cron'] as LaneName[]) {
      status[lane] = {
        running: this.running.get(lane)!.size,
        queued: this.queues.get(lane)!.length,
        concurrency: this.concurrency[lane],
      };
    }
    return status;
  }

  private async drain(lane: LaneName): Promise<void> {
    const queue = this.queues.get(lane)!;
    const runningSet = this.running.get(lane)!;

    while (queue.length > 0 && runningSet.size < this.concurrency[lane]) {
      // 查找 sessionKey 未在运行中的下一个任务（串行保障）
      const idx = queue.findIndex(item => !this.runningKeys.has(item.sessionKey));
      if (idx === -1) break;

      const [item] = queue.splice(idx, 1);
      runningSet.add(item.id);
      this.runningKeys.set(item.sessionKey, item.id);
      this.runningItems.set(item.sessionKey, item);

      // 设置超时（M13 重构：timeoutMs=0 → 不设超时，由 attempt 内的看门狗负责）
      const timer = item.timeoutMs > 0
        ? setTimeout(() => {
            item.abortController.abort();
            item.reject(new Error(`Task ${item.id} timed out after ${item.timeoutMs}ms`));
          }, item.timeoutMs)
        : null;

      // 执行任务
      item.task()
        .then(result => {
          if (timer) clearTimeout(timer);
          item.resolve(result);
        })
        .catch(err => {
          if (timer) clearTimeout(timer);
          item.reject(err);
        })
        .finally(() => {
          runningSet.delete(item.id);
          this.runningKeys.delete(item.sessionKey);
          this.runningItems.delete(item.sessionKey);
          this.drain(lane);
        });
    }
  }
}
