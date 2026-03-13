import { MemoryStore } from './memory-store.js';
import { HOTNESS_HALF_LIFE_DAYS } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/**
 * 衰减调度器 — 定期更新记忆的 activation 分数
 *
 * 衰减公式: activation = sigmoid(log1p(access_count)) × exp(-decayRate × age_days)
 * 其中 decayRate = ln(2) / HOTNESS_HALF_LIFE_DAYS
 *
 * 归档条件: activation < 0.1 且 30 天未访问
 */
export class DecayScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private store: MemoryStore;

  constructor(
    private db: SqliteStore,
    private intervalMs: number = 3600_000, // 默认每小时
  ) {
    this.store = new MemoryStore(db);
  }

  /** 启动定时任务 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // 启动后立即执行一次
    this.tick();
  }

  /** 停止定时任务 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 执行一次衰减计算 */
  tick(): { updated: number; archived: number } {
    const decayRate = Math.LN2 / HOTNESS_HALF_LIFE_DAYS;
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    // 查询所有非钉选、非归档的记忆
    const rows = this.db.all<{
      id: string;
      access_count: number;
      updated_at: string;
      last_access_at: string | null;
      pinned: number;
    }>(
      `SELECT id, access_count, updated_at, last_access_at, pinned
       FROM memory_units
       WHERE pinned = 0 AND archived_at IS NULL`
    );

    let updated = 0;
    let archived = 0;

    this.db.transaction(() => {
      for (const row of rows) {
        const ageDays = (now - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);
        const accessFactor = sigmoid(Math.log1p(row.access_count));
        const timeFactor = Math.exp(-decayRate * ageDays);
        const newActivation = accessFactor * timeFactor;

        // 更新 activation
        this.db.run(
          'UPDATE memory_units SET activation = ? WHERE id = ?',
          newActivation, row.id,
        );
        updated++;

        // 检查是否应归档
        const lastAccess = row.last_access_at ? new Date(row.last_access_at).getTime() : new Date(row.updated_at).getTime();
        if (newActivation < 0.1 && (now - lastAccess) > thirtyDaysMs) {
          this.store.archive(row.id);
          archived++;
        }
      }
    });

    return { updated, archived };
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.timer !== null;
  }
}

/** Sigmoid 函数 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
