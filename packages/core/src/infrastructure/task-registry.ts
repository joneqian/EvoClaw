/**
 * TaskRegistry — 统一任务生命周期追踪
 *
 * 追踪所有异步任务（Cron / Heartbeat / SubAgent / Boot / Bash）的执行状态。
 * 纯内存实现，sidecar 重启后清空。
 *
 * 支持通过 cancelFn 注册取消回调，实现统一的 cancelTask(taskId) 入口。
 */

import { createLogger } from './logger.js';

const log = createLogger('task-registry');

export type TaskRuntime = 'cron' | 'heartbeat' | 'subagent' | 'boot' | 'bash';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

/** 取消回调 — 由 runtime 在 createTask 时注册 */
export type CancelFn = () => Promise<void> | void;

/** 任务进度快照（subagent / heartbeat 有实时进度） */
export interface TaskProgress {
  toolUseCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  recentActivity?: string;
}

export interface TaskRecord {
  taskId: string;
  runtime: TaskRuntime;
  sourceId: string;
  status: TaskStatus;
  label: string;
  agentId: string;
  sessionKey: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  progress?: TaskProgress;
  /** 取消回调 — 仅内部使用，不序列化到 API */
  cancelFn?: CancelFn;
}

/** 对外公开的任务视图（剔除 cancelFn） */
export type PublicTaskRecord = Omit<TaskRecord, 'cancelFn'>;

const tasks = new Map<string, TaskRecord>();

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
]);

function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function toPublic(task: TaskRecord): PublicTaskRecord {
  const { cancelFn: _cancelFn, ...rest } = task;
  return rest;
}

/** 创建任务记录 */
export function createTask(
  record: Omit<TaskRecord, 'createdAt'>,
): string {
  const full: TaskRecord = { ...record, createdAt: Date.now() };
  tasks.set(record.taskId, full);
  return record.taskId;
}

/** 更新任务状态（终态时自动清空 cancelFn 防内存泄漏） */
export function updateTask(
  taskId: string,
  update: Partial<Pick<TaskRecord, 'status' | 'startedAt' | 'endedAt' | 'error'>>,
): void {
  const existing = tasks.get(taskId);
  if (!existing) return;
  Object.assign(existing, update);
  if (update.status && isTerminal(update.status)) {
    existing.cancelFn = undefined;
  }
}

/** 更新任务进度（subagent / heartbeat 实时进度回调） */
export function updateTaskProgress(
  taskId: string,
  progress: TaskProgress,
): void {
  const existing = tasks.get(taskId);
  if (!existing) return;
  existing.progress = { ...existing.progress, ...progress };
}

/** 获取单个任务（剔除 cancelFn） */
export function getTask(taskId: string): PublicTaskRecord | undefined {
  const task = tasks.get(taskId);
  return task ? toPublic(task) : undefined;
}

/** 列出任务（支持过滤，剔除 cancelFn） */
export function listTasks(filter?: {
  agentId?: string;
  runtime?: TaskRuntime;
  status?: TaskStatus;
}): PublicTaskRecord[] {
  let result = Array.from(tasks.values());
  if (filter?.agentId) result = result.filter(t => t.agentId === filter.agentId);
  if (filter?.runtime) result = result.filter(t => t.runtime === filter.runtime);
  if (filter?.status) result = result.filter(t => t.status === filter.status);
  return result.sort((a, b) => b.createdAt - a.createdAt).map(toPublic);
}

/** 取消任务 — 调用 cancelFn 并更新状态为 cancelled */
export async function cancelTask(taskId: string): Promise<{ cancelled: boolean; reason?: string }> {
  const task = tasks.get(taskId);
  if (!task) return { cancelled: false, reason: '任务不存在' };
  if (isTerminal(task.status)) {
    return { cancelled: false, reason: '任务已结束，无法取消' };
  }
  if (!task.cancelFn) {
    return { cancelled: false, reason: '该任务类型不支持取消' };
  }

  try {
    await task.cancelFn();
    // 更新状态（runtime 自己的完成钩子可能也会调 updateTask，
    // 这里主动标记为 cancelled 以覆盖可能晚到的 failed 状态）
    updateTask(taskId, { status: 'cancelled', endedAt: Date.now() });
    return { cancelled: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn(`取消任务 ${taskId} 失败: ${reason}`);
    return { cancelled: false, reason };
  }
}

/** 清理已结束超过 maxAgeMs 的任务记录 */
export function pruneCompleted(maxAgeMs = 3_600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [id, task] of tasks) {
    if (task.endedAt && task.endedAt < cutoff && isTerminal(task.status)) {
      tasks.delete(id);
      pruned++;
    }
  }
  return pruned;
}

/** 重置所有记录（测试用） */
export function resetTaskRegistryForTest(): void {
  tasks.clear();
}
