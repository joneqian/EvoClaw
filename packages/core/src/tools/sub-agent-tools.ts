/**
 * 子 Agent 工具 — spawn/list/kill
 * 让主 Agent 可以创建子 Agent 并行处理任务
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { SubAgentSpawner } from '../agent/sub-agent-spawner.js';

/** 创建子 Agent 工具集 */
export function createSubAgentTools(spawner: SubAgentSpawner): ToolDefinition[] {
  return [
    {
      name: 'spawn_agent',
      description: '创建一个子 Agent 来并行处理任务。子 Agent 会在后台执行，完成后结果会自动通知你。适用于可以拆分的独立子任务。',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '子 Agent 要完成的任务描述' },
          context: { type: 'string', description: '补充上下文信息（可选）' },
        },
        required: ['task'],
      },
      execute: async (args) => {
        const task = args['task'] as string;
        const context = args['context'] as string | undefined;

        if (!task) return '错误：缺少 task 参数';

        try {
          const taskId = spawner.spawn(task, context);
          return `子 Agent 已启动。\nTask ID: ${taskId}\n任务: ${task}\n\n子 Agent 正在后台执行，完成后会自动通知你结果。你可以继续处理其他事情。`;
        } catch (err) {
          return `创建子 Agent 失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_agents',
      description: '查看当前所有子 Agent 的状态（运行中/已完成/失败/已取消）。',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const agents = spawner.list();

        if (agents.length === 0) {
          return '当前没有活跃的子 Agent。';
        }

        const formatted = agents.map((a, i) => {
          const duration = a.completedAt
            ? `${((a.completedAt - a.startedAt) / 1000).toFixed(1)}s`
            : `${((Date.now() - a.startedAt) / 1000).toFixed(1)}s (进行中)`;

          let statusLine = `${i + 1}. [${a.status}] ${a.task}\n   ID: ${a.taskId}\n   耗时: ${duration}`;

          if (a.status === 'completed' && a.result) {
            const preview = a.result.length > 200
              ? a.result.slice(0, 200) + '...'
              : a.result;
            statusLine += `\n   结果预览: ${preview}`;
          }
          if (a.status === 'failed' && a.error) {
            statusLine += `\n   错误: ${a.error}`;
          }

          return statusLine;
        }).join('\n\n');

        return `子 Agent 状态（共 ${agents.length} 个）：\n\n${formatted}`;
      },
    },
    {
      name: 'kill_agent',
      description: '终止一个正在运行的子 Agent。使用 list_agents 获取 Task ID。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '要终止的子 Agent 的 Task ID' },
        },
        required: ['taskId'],
      },
      execute: async (args) => {
        const taskId = args['taskId'] as string;
        if (!taskId) return '错误：缺少 taskId 参数';

        const killed = spawner.kill(taskId);
        if (killed) {
          return `子 Agent ${taskId} 已被终止。`;
        }

        const entry = spawner.get(taskId);
        if (!entry) {
          return `未找到 Task ID 为 ${taskId} 的子 Agent。`;
        }
        return `子 Agent ${taskId} 当前状态为 "${entry.status}"，无法终止。`;
      },
    },
  ];
}
