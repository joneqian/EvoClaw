import cronParser from 'cron-parser';
import crypto from 'node:crypto';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { CronJobConfig } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';
import { enqueueSystemEvent } from '../infrastructure/system-events.js';
import { enqueueTaskNotification } from '../infrastructure/task-notifications.js';
import { createTask, updateTask } from '../infrastructure/task-registry.js';

const log = createLogger('cron');

/** 连续失败自动禁用阈值 */
const MAX_CONSECUTIVE_ERRORS = 5;

/** 数据库行类型 */
interface CronJobRow {
  id: string;
  agent_id: string;
  name: string;
  cron_expression: string;
  action_type: string;
  action_config: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  consecutive_errors: number;
  last_run_status: string | null;
  last_delivery_status: string | null;
  created_at: string;
  updated_at: string;
}

/** 将数据库行转换为 CronJobConfig */
function rowToConfig(row: CronJobRow): CronJobConfig {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    cronExpression: row.cron_expression,
    actionType: row.action_type as CronJobConfig['actionType'],
    actionConfig: JSON.parse(row.action_config),
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Cron 运行器 — Agent 定时任务调度
 *
 * 每分钟检查到期任务，通过 LaneQueue cron 车道执行（隔离会话）
 */
export class CronRunner {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: SqliteStore,
    private laneQueue: LaneQueue,
  ) {}

  /** 启动调度器（每分钟检查一次） */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 60_000);
    // 启动后立即执行一次
    this.tick();
  }

  /** 停止调度器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 执行一次调度检查 */
  async tick(): Promise<number> {
    const now = new Date().toISOString();

    // 查询到期任务
    const dueJobs = this.db.all<CronJobRow>(
      `SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= ?`,
      now,
    );

    let executed = 0;

    for (const job of dueJobs) {
      try {
        // 计算下次运行时间
        const nextRun = this.computeNextRun(job.cron_expression);
        this.db.run(
          `UPDATE cron_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?`,
          nextRun,
          now,
          job.id,
        );

        const config = JSON.parse(job.action_config);

        // event 模式：注入系统事件到主会话，不走隔离 session
        if (job.action_type === 'event') {
          const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
          const text = config.prompt ?? `[Cron: ${job.name}] 请执行计划任务。`;
          const eventTaskId = `cron-event-${job.id}-${crypto.randomUUID()}`;
          createTask({
            taskId: eventTaskId, runtime: 'cron', sourceId: job.id,
            status: 'running', label: `cron:event:${job.name}`,
            agentId: job.agent_id, sessionKey: mainSessionKey, startedAt: Date.now(),
          });
          enqueueSystemEvent(text, mainSessionKey);
          this.db.run(
            `UPDATE cron_jobs SET last_run_at = ?, last_run_status = 'ok', consecutive_errors = 0, updated_at = ? WHERE id = ?`,
            now, now, job.id,
          );
          updateTask(eventTaskId, { status: 'succeeded', endedAt: Date.now() });
          executed++;
          log.debug(`cron job ${job.name} → system event 已注入`);
          continue;
        }

        // 通过 LaneQueue cron 车道执行（隔离会话）
        const sessionKey = `agent:${job.agent_id}:cron:${job.id}`;
        const cronTaskId = `cron-${job.id}-${crypto.randomUUID()}`;
        const cronStartedAt = Date.now();
        createTask({
          taskId: cronTaskId, runtime: 'cron', sourceId: job.id,
          status: 'queued', label: `cron:${job.action_type}:${job.name}`,
          agentId: job.agent_id, sessionKey, startedAt: undefined,
          cancelFn: () => {
            // 从队列移除未执行的任务 + 中止运行中的
            this.laneQueue.cancel(cronTaskId);
          },
        });

        this.laneQueue.enqueue({
          id: cronTaskId,
          sessionKey,
          lane: 'cron',
          task: async () => {
            // 根据 action_type 构建 prompt
            const prompt = config.prompt ?? `[Cron: ${job.name}] 请执行计划任务。`;
            return prompt;
          },
          timeoutMs: 300_000, // 5 分钟
        }).then(() => {
          // 成功：更新 last_run_at + 重置错误计数
          const ts = new Date().toISOString();
          this.db.run(
            `UPDATE cron_jobs SET last_run_at = ?, last_run_status = 'ok', consecutive_errors = 0, updated_at = ? WHERE id = ?`,
            ts, ts, job.id,
          );
          updateTask(cronTaskId, { status: 'succeeded', endedAt: Date.now() });
          // 通知回流 — 主 session 感知 cron 完成
          try {
            const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
            enqueueTaskNotification({
              taskId: cronTaskId,
              kind: 'cron',
              status: 'completed',
              title: job.name,
              durationMs: Date.now() - cronStartedAt,
            }, mainSessionKey);
          } catch { /* 通知失败不影响主流程 */ }
        }).catch((err) => {
          log.error(`任务 ${job.name} (${job.id}) 执行失败:`, err);
          this.recordError(job.id, job.name);
          updateTask(cronTaskId, { status: 'failed', endedAt: Date.now(), error: String(err) });
          // 通知回流 — 失败也让主 session 感知
          try {
            const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
            enqueueTaskNotification({
              taskId: cronTaskId,
              kind: 'cron',
              status: 'failed',
              title: job.name,
              error: String(err),
              durationMs: Date.now() - cronStartedAt,
            }, mainSessionKey);
          } catch { /* ignore */ }
        });

        executed++;
      } catch (err) {
        log.error(`调度任务 ${job.id} 失败:`, err);
      }
    }

    return executed;
  }

  /** 创建定时任务 */
  scheduleJob(
    agentId: string,
    config: { name: string; cronExpression: string; actionType: string; actionConfig?: Record<string, unknown> },
  ): CronJobConfig {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const nextRun = this.computeNextRun(config.cronExpression);

    this.db.run(
      `INSERT INTO cron_jobs (id, agent_id, name, cron_expression, action_type, action_config, enabled, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      agentId,
      config.name,
      config.cronExpression,
      config.actionType,
      JSON.stringify(config.actionConfig ?? {}),
      nextRun,
      now,
      now,
    );

    return {
      id,
      agentId,
      name: config.name,
      cronExpression: config.cronExpression,
      actionType: config.actionType as CronJobConfig['actionType'],
      actionConfig: config.actionConfig ?? {},
      enabled: true,
      lastRunAt: null,
      nextRunAt: nextRun,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 更新定时任务 */
  updateJob(
    id: string,
    updates: Partial<{ name: string; cronExpression: string; actionType: string; actionConfig: Record<string, unknown>; enabled: boolean }>,
  ): boolean {
    const existing = this.db.get<CronJobRow>(
      'SELECT * FROM cron_jobs WHERE id = ?',
      id,
    );
    if (!existing) return false;

    const now = new Date().toISOString();
    const cron = updates.cronExpression ?? existing.cron_expression;
    const nextRun = updates.cronExpression ? this.computeNextRun(cron) : existing.next_run_at;

    this.db.run(
      `UPDATE cron_jobs
       SET name = ?, cron_expression = ?, action_type = ?, action_config = ?, enabled = ?, next_run_at = ?, updated_at = ?
       WHERE id = ?`,
      updates.name ?? existing.name,
      cron,
      updates.actionType ?? existing.action_type,
      JSON.stringify(updates.actionConfig ?? JSON.parse(existing.action_config)),
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled,
      nextRun,
      now,
      id,
    );

    return true;
  }

  /** 删除任务 */
  removeJob(id: string): boolean {
    const result = this.db.run('DELETE FROM cron_jobs WHERE id = ?', id);
    return result.changes > 0;
  }

  /** 列出 Agent 的任务 */
  listJobs(agentId: string): CronJobConfig[] {
    const rows = this.db.all<CronJobRow>(
      'SELECT * FROM cron_jobs WHERE agent_id = ? ORDER BY created_at DESC',
      agentId,
    );
    return rows.map(rowToConfig);
  }

  /** 记录执行失败 + 连续失败自动禁用 */
  private recordError(jobId: string, jobName: string): void {
    const ts = new Date().toISOString();
    this.db.run(
      `UPDATE cron_jobs SET last_run_status = 'error', consecutive_errors = consecutive_errors + 1, updated_at = ? WHERE id = ?`,
      ts, jobId,
    );

    const row = this.db.get<{ consecutive_errors: number }>(
      'SELECT consecutive_errors FROM cron_jobs WHERE id = ?',
      jobId,
    );
    if (row && row.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
      this.db.run('UPDATE cron_jobs SET enabled = 0, updated_at = ? WHERE id = ?', ts, jobId);
      log.warn(`任务 ${jobName} 连续失败 ${MAX_CONSECUTIVE_ERRORS} 次，已自动禁用`);
    }
  }

  /** 计算下次运行时间 */
  private computeNextRun(cronExpression: string): string {
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().toISOString();
  }

  /** 是否正在运行 */
  get isRunning(): boolean {
    return this.timer !== null;
  }
}
