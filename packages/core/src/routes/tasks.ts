import { Hono } from 'hono';
import { listTasks, getTask, pruneCompleted, type TaskRuntime, type TaskStatus } from '../scheduler/task-registry.js';

/**
 * Tasks 路由 — 统一任务追踪 API
 */
export function createTaskRoutes(): Hono {
  const app = new Hono();

  /** 列出任务（支持 agentId / runtime / status 过滤） */
  app.get('/', (c) => {
    const agentId = c.req.query('agentId') || undefined;
    const runtime = (c.req.query('runtime') || undefined) as TaskRuntime | undefined;
    const status = (c.req.query('status') || undefined) as TaskStatus | undefined;

    const tasks = listTasks({ agentId, runtime, status });
    return c.json({ success: true, data: tasks });
  });

  /** 获取单个任务 */
  app.get('/:taskId', (c) => {
    const task = getTask(c.req.param('taskId'));
    if (!task) {
      return c.json({ success: false, error: '任务不存在' }, 404);
    }
    return c.json({ success: true, data: task });
  });

  /** 清理已结束超过 1 小时的记录 */
  app.post('/prune', (c) => {
    const pruned = pruneCompleted();
    return c.json({ success: true, data: { pruned } });
  });

  return app;
}
