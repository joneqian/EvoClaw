import type { HeartbeatConfig } from '@evoclaw/shared';
import { isInActiveHours, DEFAULT_ACTIVE_HOURS } from './active-hours.js';
import { createLogger } from '../infrastructure/logger.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { isHeartbeatContentEffectivelyEmpty, detectHeartbeatAck } from './heartbeat-utils.js';
import { buildHeartbeatPrompt, type HeartbeatReason } from './heartbeat-prompts.js';
import { hasSystemEvents, peekSystemEvents } from '../infrastructure/system-events.js';
import { HeartbeatWakeCoalescer, WakePriority } from './heartbeat-wake.js';
import { createTask, updateTask } from './task-registry.js';
import crypto from 'node:crypto';

const log = createLogger('heartbeat');

/** Heartbeat 执行选项 */
export interface HeartbeatExecuteOpts {
  lightContext?: boolean;
  model?: string;
}

/**
 * Heartbeat 执行函数签名
 *
 * @param agentId   Agent ID
 * @param message   Heartbeat prompt
 * @param sessionKey  会话 key（如 agent:{id}:heartbeat）
 * @param opts      执行选项（lightContext / model 覆盖）
 * @returns LLM 响应文本
 */
export type HeartbeatExecuteFn = (
  agentId: string,
  message: string,
  sessionKey: string,
  opts?: HeartbeatExecuteOpts,
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
  private wakeCoalescer?: HeartbeatWakeCoalescer;

  constructor(
    private agentId: string,
    private config: HeartbeatConfig,
    private executeFn: HeartbeatExecuteFn,
    private onResult?: HeartbeatResultCallback,
    private db?: SqliteStore,
    private readWorkspaceFile?: (filename: string) => string | null,
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
    this.wakeCoalescer?.dispose();
  }

  /** 请求立即执行一次心跳（合并防抖） */
  requestNow(reason: HeartbeatReason = 'wake'): void {
    if (!this.wakeCoalescer) {
      this.wakeCoalescer = new HeartbeatWakeCoalescer(
        (r) => this.tick(r).then(() => {}),
      );
    }
    this.wakeCoalescer.request(reason, WakePriority.ACTION);
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
  async tick(reason: HeartbeatReason = 'interval'): Promise<'skipped' | 'ok' | 'active'> {
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

    // 3. 解析 session key（支持隔离 session）
    const sessionKey = this.resolveSessionKey();

    // 4. HEARTBEAT.md 空文件预检 — 无可执行内容且无系统事件时跳过 LLM 调用
    if (this.readWorkspaceFile) {
      const heartbeatContent = this.readWorkspaceFile('HEARTBEAT.md');
      if (isHeartbeatContentEffectivelyEmpty(heartbeatContent)) {
        if (!hasSystemEvents(sessionKey)) {
          log.debug(`agent ${this.agentId} HEARTBEAT.md 为空且无系统事件，跳过`);
          return 'skipped';
        }
      }
    }

    // 5. 确定实际触发原因（有 system events 时覆盖为 cron-event）
    const pendingEvents = peekSystemEvents(sessionKey);
    const effectiveReason = pendingEvents.length > 0 ? 'cron-event' as const : reason;

    // 6. 构建 reason-based prompt
    const prompt = buildHeartbeatPrompt({
      reason: effectiveReason,
      customPrompt: this.config.prompt,
      currentTime: new Date().toISOString(),
      cronEventTexts: effectiveReason === 'cron-event' ? pendingEvents : undefined,
      deliverToUser: this.config.target !== 'none',
    });

    // 7. TaskRegistry 追踪
    const taskId = crypto.randomUUID();
    createTask({
      taskId,
      runtime: 'heartbeat',
      sourceId: this.agentId,
      status: 'running',
      label: `heartbeat:${effectiveReason}`,
      agentId: this.agentId,
      sessionKey,
      startedAt: Date.now(),
    });

    try {
      const result = await this.executeFn(this.agentId, prompt, sessionKey, {
        lightContext: this.config.lightContext,
        model: this.config.model,
      });
      this.lastExecutedAt = Date.now();

      // 零污染回滚：鲁棒 ACK 检测（支持 Markdown/HTML 包裹、尾随标点等变体）
      const ack = detectHeartbeatAck(result, this.config.ackMaxChars);
      const status = ack.isAck ? 'ok' as const : 'active' as const;

      updateTask(taskId, { status: 'succeeded', endedAt: Date.now() });

      // 通知结果回调（渠道投递等后处理）
      try {
        this.onResult?.(this.agentId, status, result ?? '', this.config);
      } catch (cbErr) {
        log.error(`agent ${this.agentId} heartbeat onResult 回调失败`, cbErr);
      }

      return status;
    } catch (err) {
      // Agent 已删除（404）→ 自动停止 runner，避免持续错误
      const errMsg = String(err);
      if (errMsg.includes('404') && errMsg.includes('Agent 不存在')) {
        log.info(`agent ${this.agentId} 已不存在，自动停止心跳`);
        updateTask(taskId, { status: 'failed', endedAt: Date.now(), error: 'Agent 不存在' });
        this.stop();
        return 'skipped';
      }
      log.error(`agent ${this.agentId} 心跳失败`, err);
      updateTask(taskId, { status: 'failed', endedAt: Date.now(), error: errMsg });
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

  /** 解析 session key — 支持隔离 session 模式 */
  private resolveSessionKey(): string {
    if (this.config.isolatedSession) {
      return `agent:${this.agentId}:heartbeat`;
    }
    return this.resolveMainSessionKey();
  }

  /** 解析 Agent 最近活跃的主会话 session key */
  private resolveMainSessionKey(): string {
    if (this.db) {
      // 查找最近的本地对话 session（排除 heartbeat/cron/boot/subagent 会话）
      const row = this.db.get<{ session_key: string }>(
        `SELECT session_key FROM conversation_log
         WHERE agent_id = ?
           AND session_key LIKE 'agent:%:local:%'
           AND session_key NOT LIKE '%:cron:%'
           AND session_key NOT LIKE '%:subagent:%'
           AND session_key NOT LIKE '%:boot%'
         ORDER BY created_at DESC LIMIT 1`,
        this.agentId,
      );
      if (row) return row.session_key;
    }
    // 兜底：构造默认 session key
    return `agent:${this.agentId}:local:direct:local-user`;
  }
}
