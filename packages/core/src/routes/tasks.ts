import { Hono } from 'hono';
import {
  listTasks,
  getTask,
  pruneCompleted,
  cancelTask,
  type TaskRuntime,
  type TaskStatus,
} from '../infrastructure/task-registry.js';

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

  /** 取消任务 — 调用对应 runtime 注册的 cancelFn */
  app.post('/:taskId/cancel', async (c) => {
    const taskId = c.req.param('taskId');
    const result = await cancelTask(taskId);
    if (!result.cancelled) {
      const status = result.reason === '任务不存在' ? 404 : 400;
      return c.json({ success: false, error: result.reason }, status);
    }
    return c.json({ success: true });
  });

  /** 清理已结束超过 1 小时的记录 */
  app.post('/prune', (c) => {
    const pruned = pruneCompleted();
    return c.json({ success: true, data: { pruned } });
  });

  return app;
}
