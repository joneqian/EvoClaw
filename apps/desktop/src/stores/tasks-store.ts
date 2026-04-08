/**
 * tasks-store — 后台任务面板状态管理
 *
 * 从 sidecar 的 /tasks 接口聚合 SubAgent / Cron / Heartbeat / Boot / Bash 5 类运行时。
 * 5 秒轮询策略，简单可靠（企业面板场景延迟可接受）。
 */

import { create } from 'zustand';
import { get as apiGet, post as apiPost } from '../lib/api';

export type TaskRuntime = 'cron' | 'heartbeat' | 'subagent' | 'boot' | 'bash';
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

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
}

interface TasksState {
  tasks: TaskRecord[];
  loading: boolean;
  error: string | null;
  /** 派生：status in running/queued 的任务数量 */
  activeCount: number;

  fetchTasks: (filter?: {
    agentId?: string;
    runtime?: TaskRuntime;
    status?: TaskStatus;
  }) => Promise<void>;
  cancelTask: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
  pruneCompleted: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

function computeActiveCount(tasks: TaskRecord[]): number {
  return tasks.filter(t => t.status === 'running' || t.status === 'queued').length;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  activeCount: 0,

  fetchTasks: async (filter) => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (filter?.agentId) params.set('agentId', filter.agentId);
      if (filter?.runtime) params.set('runtime', filter.runtime);
      if (filter?.status) params.set('status', filter.status);
      const qs = params.toString();
      const res = await apiGet<{ success: boolean; data: TaskRecord[] }>(
        qs ? `/tasks?${qs}` : '/tasks',
      );
      const tasks = res.data ?? [];
      set({ tasks, activeCount: computeActiveCount(tasks), loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '加载失败',
        loading: false,
      });
    }
  },

  cancelTask: async (taskId) => {
    try {
      await apiPost(`/tasks/${taskId}/cancel`, {});
      // 立即刷新（不等轮询）
      await get().fetchTasks();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '取消失败' };
    }
  },

  pruneCompleted: async () => {
    try {
      await apiPost('/tasks/prune', {});
      await get().fetchTasks();
    } catch { /* ignore */ }
  },

  startPolling: (intervalMs = 5000) => {
    refCount++;
    if (pollTimer) return;
    // 立即拉一次
    void get().fetchTasks();
    pollTimer = setInterval(() => {
      void get().fetchTasks();
    }, intervalMs);
  },

  stopPolling: () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
