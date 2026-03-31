import type { HeartbeatConfig } from '@evoclaw/shared';
import { HeartbeatRunner, type HeartbeatExecuteFn, type HeartbeatResultCallback } from './heartbeat-runner.js';
import type { HeartbeatReason } from './heartbeat-prompts.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('heartbeat-manager');

/** Heartbeat 默认配置 */
const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMinutes: 30,
  activeHours: { start: '08:00', end: '22:00' },
  enabled: true,
};

/**
 * HeartbeatManager — 管理多 Agent 的 HeartbeatRunner 实例
 *
 * 负责：
 * - 为每个 Agent 创建/销毁 HeartbeatRunner
 * - 从 DB 读取 heartbeat 配置
 * - Agent 创建/删除时的生命周期回调
 * - 统一 start/stop 所有 runner
 */
export class HeartbeatManager {
  private readonly runners = new Map<string, HeartbeatRunner>();

  constructor(
    private readonly db: SqliteStore,
    private readonly executeFn: HeartbeatExecuteFn,
    private readonly onResult?: HeartbeatResultCallback,
    private readonly readWorkspaceFile?: (agentId: string, filename: string) => string | null,
  ) {}

  /**
   * 从 DB 读取 Agent 的 heartbeat 配置
   * 存储在 audit_log 表，action='heartbeat_config'
   */
  readConfig(agentId: string): HeartbeatConfig {
    const row = this.db.get<{ details: string }>(
      `SELECT details FROM audit_log
       WHERE agent_id = ? AND action = 'heartbeat_config'
       ORDER BY created_at DESC LIMIT 1`,
      agentId,
    );
    if (!row) return { ...DEFAULT_HEARTBEAT_CONFIG };
    try {
      return { ...DEFAULT_HEARTBEAT_CONFIG, ...JSON.parse(row.details) };
    } catch {
      return { ...DEFAULT_HEARTBEAT_CONFIG };
    }
  }

  /** 为 Agent 创建或替换 runner */
  ensureRunner(agentId: string, config?: HeartbeatConfig): void {
    // 如果已有，先停止
    const existing = this.runners.get(agentId);
    if (existing) {
      existing.stop();
    }

    const resolvedConfig = config ?? this.readConfig(agentId);
    const readFn = this.readWorkspaceFile
      ? (filename: string) => this.readWorkspaceFile!(agentId, filename)
      : undefined;
    const runner = new HeartbeatRunner(agentId, resolvedConfig, this.executeFn, this.onResult, this.db, readFn);
    this.runners.set(agentId, runner);

    if (resolvedConfig.enabled) {
      runner.start();
      log.info(`agent ${agentId} heartbeat 已启动 (间隔=${resolvedConfig.intervalMinutes}m)`);
    }
  }

  /** 停止并移除 Agent 的 runner */
  removeRunner(agentId: string): void {
    const runner = this.runners.get(agentId);
    if (runner) {
      runner.stop();
      this.runners.delete(agentId);
      log.info(`agent ${agentId} heartbeat 已移除`);
    }
  }

  /** 更新 Agent 的 heartbeat 配置（API 调用时触发） */
  updateConfig(agentId: string, config: HeartbeatConfig): void {
    const runner = this.runners.get(agentId);
    if (runner) {
      runner.updateConfig(config);
      if (config.enabled && !runner.isRunning) {
        runner.start();
      } else if (!config.enabled && runner.isRunning) {
        runner.stop();
      }
    } else {
      // runner 不存在则创建
      this.ensureRunner(agentId, config);
    }
  }

  /** 为所有活跃 Agent 初始化并启动 runner */
  startAll(): void {
    const agents = this.db.all<{ id: string }>(
      `SELECT id FROM agents WHERE status = 'active'`,
    );
    for (const agent of agents) {
      this.ensureRunner(agent.id);
    }
    log.info(`HeartbeatManager 已为 ${this.runners.size} 个 Agent 初始化`);
  }

  /** 停止所有 runner */
  stopAll(): void {
    for (const [, runner] of this.runners) {
      runner.stop();
    }
    this.runners.clear();
    log.info('HeartbeatManager 已停止所有 runner');
  }

  /** 请求立即执行指定 Agent 的心跳（合并防抖） */
  requestNow(agentId: string, reason?: HeartbeatReason): void {
    this.runners.get(agentId)?.requestNow(reason);
  }

  /** 获取指定 Agent 的 runner（测试/调试用） */
  getRunner(agentId: string): HeartbeatRunner | undefined {
    return this.runners.get(agentId);
  }

  /** 获取所有 runner 的状态 */
  getStatus(): Array<{ agentId: string; running: boolean; config: HeartbeatConfig }> {
    return Array.from(this.runners.entries()).map(([agentId, runner]) => ({
      agentId,
      running: runner.isRunning,
      config: runner.getConfig(),
    }));
  }
}
