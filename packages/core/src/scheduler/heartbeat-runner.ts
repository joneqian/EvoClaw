import type { HeartbeatConfig } from '@evoclaw/shared';
import { isInActiveHours, DEFAULT_ACTIVE_HOURS } from './active-hours.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('heartbeat');

/**
 * Heartbeat 执行函数签名
 *
 * @param agentId   Agent ID
 * @param message   Heartbeat prompt
 * @param sessionKey  会话 key（如 agent:{id}:heartbeat）
 * @returns LLM 响应文本
 */
export type HeartbeatExecuteFn = (
  agentId: string,
  message: string,
  sessionKey: string,
) => Promise<string>;

/**
 * Heartbeat 结果回调（用于渠道投递等后处理）
 */
export type HeartbeatResultCallback = (
  agentId: string,
  result: 'ok' | 'active',
  response: string,
  config: HeartbeatConfig,
) => void;

/**
 * Heartbeat 运行器 — Agent 定时心跳调度
 *
 * 通过注入的 executeFn 调用 LLM，不直接依赖 db/laneQueue。
 * executeFn 由上层（server.ts）提供，内部负责排队和 LLM 执行。
 */
export class HeartbeatRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastExecutedAt = 0;

  constructor(
    private agentId: string,
    private config: HeartbeatConfig,
    private executeFn: HeartbeatExecuteFn,
    private onResult?: HeartbeatResultCallback,
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

    // 3. 构建 heartbeat prompt 并通过 executeFn 执行
    const sessionKey = `agent:${this.agentId}:heartbeat`;
    const prompt = `[Heartbeat] 当前时间: ${new Date().toISOString()}。读取 HEARTBEAT.md（工作区文件）并严格执行。不要从历史对话推断旧任务。如果没有需要注意的事项，回复 HEARTBEAT_OK。`;

    try {
      const result = await this.executeFn(this.agentId, prompt, sessionKey);
      this.lastExecutedAt = Date.now();

      // 零污染回滚：HEARTBEAT_OK / NO_REPLY → 返回 'ok'，chat.ts 不保存任何消息
      const isOk = typeof result === 'string' && (result.includes('HEARTBEAT_OK') || result.includes('NO_REPLY'));
      const status = isOk ? 'ok' as const : 'active' as const;

      // 通知结果回调（渠道投递等后处理）
      try {
        this.onResult?.(this.agentId, status, result ?? '', this.config);
      } catch (cbErr) {
        log.error(`agent ${this.agentId} heartbeat onResult 回调失败`, cbErr);
      }

      return status;
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
