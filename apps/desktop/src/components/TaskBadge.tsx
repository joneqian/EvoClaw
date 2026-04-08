/**
 * TaskBadge — 顶部状态栏活跃任务 pill
 *
 * 展示当前运行中的后台任务数量，点击跳转 /tasks 页面。
 * 数据来自 useTasksStore.activeCount（由 tasks-store 的 5s 轮询维护）。
 * 0 时自动隐藏。
 */

import { useNavigate } from 'react-router-dom';
import { useTasksStore } from '../stores/tasks-store';

export default function TaskBadge() {
  const navigate = useNavigate();
  const activeCount = useTasksStore(s => s.activeCount);

  if (activeCount === 0) return null;

  return (
    <button
      onClick={() => navigate('/tasks')}
      className="flex items-center gap-1.5 px-2.5 py-1 mx-1 rounded-full
                 bg-brand/10 text-brand hover:bg-brand/20 transition-colors
                 text-xs font-medium"
      title="点击查看后台任务"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
      <span>{activeCount} 个后台任务</span>
    </button>
  );
}
