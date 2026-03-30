/**
 * TodoWrite 约束工具 — 结构化任务追踪
 *
 * 参考 Claude Code TodoWrite：max 20 tasks, 同时仅 1 个 in_progress。
 * 存储在 Agent workspace 的 TODO.json 文件中。
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';

/** 任务条目 */
export interface TodoTask {
  id: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
}

/** 工具工厂选项 */
interface TodoToolOpts {
  readFile: () => string | undefined;
  writeFile: (content: string) => void;
}

const MAX_TASKS = 20;
const VALID_STATUSES = new Set(['todo', 'in_progress', 'done']);

/** 从 workspace 加载当前任务列表 */
export function loadTodoState(readFile: () => string | undefined): TodoTask[] {
  const raw = readFile();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 格式化任务状态用于 system prompt 注入 */
export function formatTodoForPrompt(tasks: TodoTask[]): string {
  if (tasks.length === 0) return '';
  const inProgress = tasks.filter(t => t.status === 'in_progress');
  const todo = tasks.filter(t => t.status === 'todo');
  const done = tasks.filter(t => t.status === 'done');
  return `<current_tasks>
进行中: ${inProgress.map(t => `[${t.id}] ${t.description}`).join(', ') || '无'}
待办: ${todo.map(t => `[${t.id}] ${t.description}`).join(', ') || '无'}
已完成: ${done.length} 项
</current_tasks>`;
}

/** 创建 todo_write 工具 */
export function createTodoWriteTool(opts: TodoToolOpts): ToolDefinition {
  return {
    name: 'todo_write',
    description: '更新结构化任务列表。用于追踪复杂任务的进度。规则：最多 20 项任务，同时仅 1 项可为 in_progress 状态。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '完整的任务列表（每次调用传入全量列表，非增量）',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '任务唯一标识（简短，如 "1", "auth", "fix-bug"）' },
              description: { type: 'string', description: '任务描述' },
              status: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: '任务状态' },
            },
            required: ['id', 'description', 'status'],
          },
        },
      },
      required: ['tasks'],
    },
    execute: async (args) => {
      const rawTasks = args['tasks'];
      if (!Array.isArray(rawTasks)) {
        return '错误：tasks 参数必须是数组';
      }

      // 校验任务数量
      if (rawTasks.length > MAX_TASKS) {
        return `错误：任务数量超出上限（当前 ${rawTasks.length}，最多 ${MAX_TASKS}）`;
      }

      // 校验并规范化每条任务
      const tasks: TodoTask[] = [];
      const seenIds = new Set<string>();

      for (const raw of rawTasks) {
        const id = String(raw.id ?? '').trim();
        const description = String(raw.description ?? '').trim();
        const status = String(raw.status ?? '').trim();

        if (!id) return '错误：每个任务必须有非空 id';
        if (!description) return `错误：任务 "${id}" 缺少 description`;
        if (!VALID_STATUSES.has(status)) {
          return `错误：任务 "${id}" 的 status "${status}" 无效，允许值: todo, in_progress, done`;
        }
        if (seenIds.has(id)) return `错误：重复的任务 id "${id}"`;
        seenIds.add(id);

        tasks.push({ id, description, status: status as TodoTask['status'] });
      }

      // 校验同时仅 1 个 in_progress
      const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
      if (inProgressCount > 1) {
        return `错误：同时仅允许 1 个 in_progress 任务（当前 ${inProgressCount} 个）`;
      }

      // 持久化到 workspace
      opts.writeFile(JSON.stringify(tasks, null, 2));

      // 返回状态摘要
      const todo = tasks.filter(t => t.status === 'todo').length;
      const done = tasks.filter(t => t.status === 'done').length;
      const ip = inProgressCount;
      return `任务列表已更新：${tasks.length} 项（待办 ${todo}，进行中 ${ip}，已完成 ${done}）`;
    },
  };
}
