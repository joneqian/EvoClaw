/**
 * TasksPage — 后台任务面板
 *
 * 聚合展示 SubAgent / Cron / Heartbeat / Boot / Bash 所有运行时任务，
 * 支持按 runtime / 状态过滤、查看进度、一键中止运行中任务、清理历史。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTasksStore, type TaskRuntime, type TaskStatus, type TaskRecord } from '../stores/tasks-store';
import { useAgentStore } from '../stores/agent-store';

const RUNTIME_LABELS: Record<TaskRuntime, string> = {
  subagent: '子代理',
  cron: '定时任务',
  heartbeat: '心跳',
  bash: '后台进程',
  boot: '启动任务',
};

const RUNTIME_COLORS: Record<TaskRuntime, { bg: string; text: string; ring: string }> = {
  subagent: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-600 dark:text-purple-300', ring: 'ring-info/40' },
  cron: { bg: 'bg-info/10', text: 'text-info', ring: 'ring-info/40' },
  heartbeat: { bg: 'bg-success/10', text: 'text-success', ring: 'ring-success/40' },
  bash: { bg: 'bg-accent', text: 'text-muted-foreground', ring: 'ring-border' },
  boot: { bg: 'bg-warning/10', text: 'text-warning', ring: 'ring-warning/40' },
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; dot: string; text: string }> = {
  queued: { label: '排队中', dot: 'bg-border', text: 'text-muted-foreground' },
  running: { label: '运行中', dot: 'bg-info animate-pulse', text: 'text-info' },
  succeeded: { label: '已完成', dot: 'bg-success', text: 'text-success' },
  failed: { label: '失败', dot: 'bg-danger', text: 'text-danger' },
  timed_out: { label: '超时', dot: 'bg-warning', text: 'text-warning' },
  cancelled: { label: '已取消', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec - min * 60);
  return `${min}m${rem}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

/** 实时耗时组件 — 运行中的任务每秒刷新 */
function LiveDuration({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{formatDuration(now - startedAt)}</span>;
}

interface TaskRowProps {
  task: TaskRecord;
  agentName: string;
  onCancel: (taskId: string) => void;
}

function TaskRow({ task, agentName, onCancel }: TaskRowProps) {
  const runtimeColor = RUNTIME_COLORS[task.runtime];
  const statusCfg = STATUS_CONFIG[task.status];
  const isActive = task.status === 'running' || task.status === 'queued';
  const hasProgress = task.progress && (
    task.progress.toolUseCount !== undefined ||
    task.progress.inputTokens !== undefined
  );

  return (
    <div className={`group px-4 py-3 border-b border-border hover:bg-muted/60 transition-colors`}>
      <div className="flex items-start gap-3">
        {/* Runtime 徽标 */}
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${runtimeColor.bg} ${runtimeColor.text} ${runtimeColor.ring}`}
        >
          {RUNTIME_LABELS[task.runtime]}
        </span>

        {/* 标题 + 元信息 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-foreground font-medium">
            <span className="truncate">{task.label || task.sourceId || task.taskId}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
              <span className={statusCfg.text}>{statusCfg.label}</span>
            </span>
            {agentName && <span>· {agentName}</span>}
            {task.startedAt && (
              <span>
                · {isActive
                  ? <LiveDuration startedAt={task.startedAt} />
                  : task.endedAt
                    ? formatDuration(task.endedAt - task.startedAt)
                    : '-'}
              </span>
            )}
            <span>· {formatTimestamp(task.createdAt)}</span>
          </div>

          {/* 进度（仅运行中且有数据） */}
          {isActive && hasProgress && (
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              {task.progress?.toolUseCount !== undefined && (
                <span>工具调用 {task.progress.toolUseCount}</span>
              )}
              {task.progress?.inputTokens !== undefined && task.progress.inputTokens > 0 && (
                <span>输入 {task.progress.inputTokens} tok</span>
              )}
              {task.progress?.outputTokens !== undefined && task.progress.outputTokens > 0 && (
                <span>输出 {task.progress.outputTokens} tok</span>
              )}
              {task.progress?.recentActivity && (
                <span className="truncate">最近: {task.progress.recentActivity}</span>
              )}
            </div>
          )}

          {/* 错误信息 */}
          {task.error && (
            <div className="mt-1.5 text-xs text-danger truncate" title={task.error}>
              {task.error}
            </div>
          )}
        </div>

        {/* 操作区 */}
        {isActive && (
          <button
            onClick={() => onCancel(task.taskId)}
            className="shrink-0 px-2.5 py-1 text-xs font-medium text-danger border border-danger/30 rounded-md
                       hover:bg-danger/10 transition-colors opacity-0 group-hover:opacity-100"
          >
            中止
          </button>
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { t } = useTranslation();
  const {
    tasks,
    loading,
    error,
    fetchTasks,
    cancelTask,
    pruneCompleted,
    startPolling,
    stopPolling,
  } = useTasksStore();

  const { agents, fetchAgents } = useAgentStore();

  const [runtimeFilter, setRuntimeFilter] = useState<TaskRuntime | 'all'>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    startPolling(5000);
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  const agentNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (runtimeFilter !== 'all' && t.runtime !== runtimeFilter) return false;
      if (activeOnly && t.status !== 'running' && t.status !== 'queued') return false;
      return true;
    });
  }, [tasks, runtimeFilter, activeOnly]);

  const stats = useMemo(() => {
    let running = 0;
    let ended = 0;
    for (const t of tasks) {
      if (t.status === 'running' || t.status === 'queued') running++;
      else ended++;
    }
    return { total: tasks.length, running, ended };
  }, [tasks]);

  const handleCancel = (taskId: string) => {
    setConfirmCancel(taskId);
  };

  const confirmCancelTask = async () => {
    if (!confirmCancel) return;
    const result = await cancelTask(confirmCancel);
    setConfirmCancel(null);
    if (!result.ok) {
      alert(`取消失败: ${result.error ?? '未知错误'}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* 顶部标题 + 统计 */}
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t('tasksPage.title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              共 {stats.total} 个任务 · 运行中 <span className="text-info font-medium">{stats.running}</span> · 已结束 {stats.ended}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTasks()}
              disabled={loading}
              className="px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg
                         hover:bg-muted transition-colors disabled:opacity-50"
            >
              {loading ? '刷新中...' : '刷新'}
            </button>
            <button
              onClick={() => pruneCompleted()}
              className="px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg
                         hover:bg-muted transition-colors"
              title="清理已结束超过 1 小时的任务记录"
            >
              清理历史
            </button>
          </div>
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="shrink-0 px-6 py-2 border-b border-border flex items-center gap-2 overflow-x-auto">
        <button
          onClick={() => setRuntimeFilter('all')}
          className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            runtimeFilter === 'all'
              ? 'bg-brand text-white'
              : 'bg-accent text-muted-foreground hover:bg-accent'
          }`}
        >
          全部
        </button>
        {(Object.keys(RUNTIME_LABELS) as TaskRuntime[]).map(rt => (
          <button
            key={rt}
            onClick={() => setRuntimeFilter(rt)}
            className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              runtimeFilter === rt
                ? 'bg-brand text-white'
                : 'bg-accent text-muted-foreground hover:bg-accent'
            }`}
          >
            {RUNTIME_LABELS[rt]}
          </button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="rounded"
          />
          仅显示运行中
        </label>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-danger">加载失败: {error}</p>
            <button
              onClick={() => fetchTasks()}
              className="mt-2 text-xs text-brand hover:underline"
            >
              重试
            </button>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {tasks.length === 0 ? '当前没有后台任务' : '没有符合条件的任务'}
            </p>
          </div>
        ) : (
          filteredTasks.map(task => (
            <TaskRow
              key={task.taskId}
              task={task}
              agentName={agentNameMap.get(task.agentId) ?? task.agentId}
              onCancel={handleCancel}
            />
          ))
        )}
      </div>

      {/* 取消确认弹窗 */}
      {confirmCancel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setConfirmCancel(null)}
        >
          <div
            className="bg-card rounded-xl shadow-xl p-6 w-[360px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-foreground mb-2">确认中止任务</h3>
            <p className="text-sm text-muted-foreground mb-5">
              确定要中止此任务吗？运行中的工作将被终止，且无法恢复。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmCancel(null)}
                className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg
                           hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmCancelTask}
                className="px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg
                           hover:bg-danger transition-colors"
              >
                确认中止
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
