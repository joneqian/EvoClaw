/**
 * TaskRegistry — 统一任务生命周期追踪
 *
 * 追踪所有异步任务（Cron / Heartbeat / SubAgent / Boot）的执行状态。
 * 纯内存实现，sidecar 重启后清空。
 */

export type TaskRuntime = 'cron' | 'heartbeat' | 'subagent' | 'boot';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

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
}

const tasks = new Map<string, TaskRecord>();

/** 创建任务记录 */
export function createTask(
  record: Omit<TaskRecord, 'createdAt'>,
): string {
  const full: TaskRecord = { ...record, createdAt: Date.now() };
  tasks.set(record.taskId, full);
  return record.taskId;
}

/** 更新任务状态 */
export function updateTask(
  taskId: string,
  update: Partial<Pick<TaskRecord, 'status' | 'startedAt' | 'endedAt' | 'error'>>,
): void {
  const existing = tasks.get(taskId);
  if (existing) {
    Object.assign(existing, update);
  }
}

/** 获取单个任务 */
export function getTask(taskId: string): TaskRecord | undefined {
  return tasks.get(taskId);
}

/** 列出任务（支持过滤） */
export function listTasks(filter?: {
  agentId?: string;
  runtime?: TaskRuntime;
  status?: TaskStatus;
}): TaskRecord[] {
  let result = Array.from(tasks.values());
  if (filter?.agentId) result = result.filter(t => t.agentId === filter.agentId);
  if (filter?.runtime) result = result.filter(t => t.runtime === filter.runtime);
  if (filter?.status) result = result.filter(t => t.status === filter.status);
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

/** 清理已结束超过 maxAgeMs 的任务记录 */
export function pruneCompleted(maxAgeMs = 3_600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [id, task] of tasks) {
    if (
      task.endedAt &&
      task.endedAt < cutoff &&
      ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(task.status)
    ) {
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
