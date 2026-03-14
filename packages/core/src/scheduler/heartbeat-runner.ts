import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { HeartbeatConfig } from '@evoclaw/shared';
import { isInActiveHours, DEFAULT_ACTIVE_HOURS } from './active-hours.js';
import crypto from 'node:crypto';

/**
 * Heartbeat 运行器 — Agent 定时心跳调度
 *
 * 参考 DecayScheduler 模式：setInterval + start/stop 生命周期
 * 复用 LaneQueue main 车道执行，共享主会话上下文
 */
export class HeartbeatRunner {
  private timer: ReturnType<typeof setInterval> | null = null;

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

    // 2. 读取 HEARTBEAT.md
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

      // 4. 检查响应
      if (typeof result === 'string' && result.includes('HEARTBEAT_OK')) {
        return 'ok';
      }

      // 非 OK 响应 → 存入 conversation_log
      this.db.run(
        `INSERT INTO conversation_log (id, agent_id, session_key, role, content, created_at)
         VALUES (?, ?, ?, 'assistant', ?, ?)`,
        crypto.randomUUID(),
        this.agentId,
        sessionKey,
        typeof result === 'string' ? result : JSON.stringify(result),
        new Date().toISOString(),
      );

      return 'active';
    } catch (err) {
      console.error('[heartbeat]', this.agentId, err);
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
