/**
 * 子 Agent 工具 — spawn/list/kill/steer/yield
 * 让主 Agent 可以创建子 Agent 并行处理任务
 * 参考 OpenClaw sessions_spawn + subagents + sessions_yield 设计
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { SubAgentSpawner } from '../agent/sub-agent-spawner.js';

/** 创建子 Agent 工具集 */
export function createSubAgentTools(spawner: SubAgentSpawner): ToolDefinition[] {
  return [
    {
      name: 'spawn_agent',
      description: '创建一个子 Agent 来并行处理任务。子 Agent 会在后台执行，完成后结果会自动通知你。适用于可以拆分的独立子任务。创建后请使用 yield_agents 等待结果，不要轮询 list_agents。',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '子 Agent 要完成的任务描述（要详细，子 Agent 无法访问你的记忆和对话历史）' },
          context: { type: 'string', description: '补充上下文信息（可选，将所需信息直接传入）' },
          timeout: { type: 'number', description: '超时秒数（默认 300，最大 3600）' },
          agentId: { type: 'string', description: '跨 Agent 生成：目标 Agent ID（可选，默认使用当前 Agent）' },
          attachments: {
            type: 'array',
            description: '附件列表：传递文件内容给子 Agent（可选）',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '文件名' },
                content: { type: 'string', description: '文件内容' },
              },
              required: ['name', 'content'],
            },
          },
        },
        required: ['task'],
      },
      execute: async (args) => {
        const task = args['task'] as string;
        const context = args['context'] as string | undefined;
        const timeoutSec = args['timeout'] as number | undefined;
        const agentId = args['agentId'] as string | undefined;
        const attachments = args['attachments'] as Array<{ name: string; content: string }> | undefined;

        if (!task) return '错误：缺少 task 参数';

        // 超时限制
        const timeoutMs = timeoutSec
          ? Math.min(Math.max(timeoutSec, 10), 3600) * 1000
          : undefined;

        try {
          const taskId = spawner.spawn(task, context, timeoutMs, {
            agentId,
            attachments,
          });
          const lines = [
            `子 Agent 已启动。`,
            `Task ID: ${taskId}`,
            `任务: ${task}`,
            `超时: ${Math.round((timeoutMs ?? 300_000) / 1000)}s`,
            `活跃子 Agent: ${spawner.activeCount}/${5}`,
          ];
          if (agentId) lines.push(`目标 Agent: ${agentId}`);
          if (attachments?.length) lines.push(`附件: ${attachments.map(a => a.name).join(', ')}`);
          lines.push(
            ``,
            `推送式通知已启用：子 Agent 完成后结果会自动通知你。`,
            `建议使用 yield_agents 结束当前轮次等待结果，不要轮询 list_agents。`,
          );
          return lines.join('\n');
        } catch (err) {
          return `创建子 Agent 失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'list_agents',
      description: '查看当前所有子 Agent 的状态和结果。已完成的子 Agent 会显示完整结果。',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const agents = spawner.list();

        if (agents.length === 0) {
          return '当前没有子 Agent。';
        }

        const formatted = agents.map((a, i) => {
          const duration = a.completedAt
            ? `${((a.completedAt - a.startedAt) / 1000).toFixed(1)}s`
            : `${((Date.now() - a.startedAt) / 1000).toFixed(1)}s (进行中)`;

          let statusLine = `${i + 1}. [${a.status}] ${a.task.slice(0, 100)}${a.task.length > 100 ? '...' : ''}\n   ID: ${a.taskId}\n   耗时: ${duration}`;

          // 已完成：展示完整结果
          if (a.status === 'completed' && a.result) {
            statusLine += `\n   结果:\n${a.result}`;
          }
          if (a.status === 'failed' && a.error) {
            statusLine += `\n   错误: ${a.error}`;
          }

          return statusLine;
        }).join('\n\n');

        const running = agents.filter(a => a.status === 'running').length;
        const completed = agents.filter(a => a.status === 'completed').length;
        const failed = agents.filter(a => a.status === 'failed').length;

        return `子 Agent 状态（共 ${agents.length} 个，运行中 ${running}，已完成 ${completed}，失败 ${failed}）：\n\n${formatted}`;
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
    {
      name: 'steer_agent',
      description: '纠偏一个正在运行的子 Agent。终止当前运行并用纠正指令重新启动。当子 Agent 方向偏离时使用，比 kill + 重新 spawn 更方便。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '要纠偏的子 Agent 的 Task ID' },
          correction: { type: 'string', description: '纠正指令（说明方向偏差和期望的调整）' },
        },
        required: ['taskId', 'correction'],
      },
      execute: async (args) => {
        const taskId = args['taskId'] as string;
        const correction = args['correction'] as string;

        if (!taskId) return '错误：缺少 taskId 参数';
        if (!correction) return '错误：缺少 correction 参数';

        try {
          const newTaskId = spawner.steer(taskId, correction);
          return `子 Agent 已纠偏。\n原 Task ID: ${taskId}（已终止）\n新 Task ID: ${newTaskId}\n纠正指令: ${correction}`;
        } catch (err) {
          return `纠偏失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'yield_agents',
      description: '让出当前轮次，等待子 Agent 完成。创建子 Agent 后调用此工具，系统会在子 Agent 完成时自动将结果推送给你。不要轮询 list_agents，使用此工具等待即可。',
      parameters: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        // 收集已完成但未通知的结果
        const completed = spawner.collectCompletedResults();

        if (completed.length > 0) {
          // 有已完成的结果，立即返回
          const lines = completed.map(r => {
            const status = r.success ? '✅ 完成' : '❌ 失败';
            return `[${status}] 任务: ${r.task.slice(0, 80)}${r.task.length > 80 ? '...' : ''}\nTask ID: ${r.taskId}\n${r.result}`;
          });

          const stillRunning = spawner.hasRunning;
          const footer = stillRunning
            ? '\n---\n仍有子 Agent 运行中，可再次调用 yield_agents 等待剩余结果。'
            : '\n---\n所有子 Agent 已完成。';

          return `子 Agent 结果推送：\n\n${lines.join('\n\n---\n\n')}${footer}`;
        }

        if (!spawner.hasRunning) {
          return '当前没有运行中的子 Agent，无需等待。';
        }

        // 有运行中的子 Agent 但还没完成，返回等待提示
        return `当前有 ${spawner.activeCount} 个子 Agent 运行中，尚未完成。请稍后再调用 yield_agents 获取结果。\n\n注意：推送式通知已启用，子 Agent 完成后会自动通知你。你可以先继续处理其他事情。`;
      },
    },
  ];
}
