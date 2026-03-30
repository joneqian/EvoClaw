import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { HeartbeatConfig } from '@evoclaw/shared';
import { isInActiveHours, DEFAULT_ACTIVE_HOURS } from './active-hours.js';
import crypto from 'node:crypto';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('heartbeat');

/**
 * Heartbeat 运行器 — Agent 定时心跳调度
 *
 * 参考 DecayScheduler 模式：setInterval + start/stop 生命周期
 * 复用 LaneQueue main 车道执行，共享主会话上下文
 */
export class HeartbeatRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastExecutedAt = 0;

  constructor(
    private db: SqliteStore,
    private laneQueue: LaneQueue,
    private agentId: string,
    private config: HeartbeatConfig,
  ) {}

  /** 启动心跳 */
  start(): void {
    if (this.timer || !this.config.enabled) return;
    const intervalMs = this.config.intervalMinutes * 60_000;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 更新配置 */
  updateConfig(config: HeartbeatConfig): void {
    this.config = config;
    // 重启以应用新配置
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  /** 执行一次心跳 */
  async tick(): Promise<'skipped' | 'ok' | 'active'> {
    // 1. 活跃时段检查
    const activeHours = this.config.activeHours ?? DEFAULT_ACTIVE_HOURS;
    if (!isInActiveHours(activeHours)) {
      return 'skipped';
    }

    // 2. 间隔门控 — 距上次执行够久才触发
    const minIntervalMs = (this.config.minIntervalMinutes ?? 5) * 60_000;
    if (Date.now() - this.lastExecutedAt < minIntervalMs) {
      return 'skipped';
    }

    // 3. 读取 HEARTBEAT.md
    const heartbeatContent = this.db.get<{ workspace_path: string }>(
      'SELECT workspace_path FROM agents WHERE id = ?',
      this.agentId,
    );

    // 3. 通过 LaneQueue 执行
    const sessionKey = `agent:${this.agentId}:heartbeat`;
    try {
      const result = await this.laneQueue.enqueue({
        id: `heartbeat-${crypto.randomUUID()}`,
        sessionKey,
        lane: 'main',
        task: async () => {
          // 构建轻量 prompt
          const prompt = `[Heartbeat] 当前时间: ${new Date().toISOString()}。请检查是否有需要主动执行的任务。如果没有，回复 HEARTBEAT_OK。`;
          return prompt;
        },
        timeoutMs: 300_000, // 5 分钟超时
      });

      this.lastExecutedAt = Date.now();

      // 5. 检查响应
      // 零污染回滚：HEARTBEAT_OK / NO_REPLY → 返回 'ok'，chat.ts 不保存任何消息
      if (typeof result === 'string' && (result.includes('HEARTBEAT_OK') || result.includes('NO_REPLY'))) {
        return 'ok';
      }

      // 有实际工作内容 → chat.ts 管道已负责持久化，这里只返回状态
      return 'active';
    } catch (err) {
      log.error(`agent ${this.agentId} 心跳失败`, err);
      return 'skipped';
    }
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** 获取当前配置 */
  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }
}
