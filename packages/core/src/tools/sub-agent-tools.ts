/**
 * 子 Agent 工具 — spawn/list/kill/steer/yield
 * 让主 Agent 可以创建子 Agent 并行处理任务
 * 参考 OpenClaw sessions_spawn + subagents + sessions_yield 设计
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { SubAgentSpawner } from '../agent/sub-agent-spawner.js';

/** 子任务定义（decompose_task 输入） */
interface SubTaskDefinition {
  task: string;
  subagent_type?: string;
  context?: string;
}

/** 已完成子 Agent 结果的类型（与 collectCompletedResults 返回值对齐） */
interface CompletedResult {
  taskId: string;
  task: string;
  result: string;
  success: boolean;
}

/** 格式化 yield_agents 的返回文本 */
function formatYieldResult(
  completed: CompletedResult[],
  stillRunning: boolean,
  runningCount: number,
): string {
  const lines = completed.map(r => {
    const status = r.success ? '✅ 完成' : '❌ 失败';
    const taskPreview = r.task.length > 80 ? r.task.slice(0, 80) + '...' : r.task;
    return `[${status}] 任务: ${taskPreview}\nTask ID: ${r.taskId}\n${r.result}`;
  });

  const footer = stillRunning
    ? `\n---\n仍有 ${runningCount} 个子 Agent 运行中。请立即再次调用 yield_agents 继续等待剩余结果。`
    : '\n---\n所有子 Agent 已完成。';

  return `子 Agent 结果推送：\n\n${lines.join('\n\n---\n\n')}${footer}`;
}

/** 创建子 Agent 工具集 */
export function createSubAgentTools(spawner: SubAgentSpawner): ToolDefinition[] {
  return [
    {
      name: 'decompose_task',
      description: `将一个复杂任务分解为多个并行子任务，自动创建对应类型的子 Agent 并行执行。

使用条件（必须同时满足）：
- 任务确实有 2 个以上独立子任务可并行
- 每个子任务至少需要 3+ 次工具调用
- 并行执行比串行有明显时间收益

不要使用的场景：
- 单次搜索、单文件读取 → 直接自己做
- 串行依赖的步骤 → 自己按顺序执行

子 Agent 完成后会自动通知你。调用后请使用 yield_agents 等待结果。
收到结果后，你必须理解内容并基于你的判断生成最终输出，禁止原样转发。`,
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            description: '子任务列表（最多 5 个，会并行执行）',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: '子任务描述（要详细）' },
                subagent_type: {
                  type: 'string',
                  enum: ['general', 'researcher', 'writer', 'analyst'],
                  description: '子 Agent 类型（默认 general）',
                },
                context: { type: 'string', description: '补充上下文（可选）' },
              },
              required: ['task'],
            },
          },
        },
        required: ['subtasks'],
      },
      execute: async (args) => {
        const subtasks = args['subtasks'] as SubTaskDefinition[];
        if (!subtasks || !Array.isArray(subtasks) || subtasks.length === 0) {
          return '错误：subtasks 不能为空';
        }
        if (subtasks.length > 5) {
          return '错误：最多 5 个子任务（当前限制）';
        }

        const results: string[] = [];
        const errors: string[] = [];

        for (const sub of subtasks) {
          try {
            const taskId = spawner.spawn(sub.task, sub.context, undefined, {
              agentType: sub.subagent_type ?? 'general',
            });
            results.push(`  ✓ [${sub.subagent_type ?? 'general'}] ${sub.task.slice(0, 80)} → ${taskId}`);
          } catch (err) {
            errors.push(`  ✗ [${sub.subagent_type ?? 'general'}] ${sub.task.slice(0, 80)} → ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const lines = [
          `任务分解完成：${results.length} 个子 Agent 已启动${errors.length > 0 ? `，${errors.length} 个失败` : ''}`,
          '',
          ...results,
        ];
        if (errors.length > 0) {
          lines.push('', '失败：', ...errors);
        }
        lines.push(
          '',
          `活跃子 Agent: ${spawner.activeCount}/${5}`,
          '使用 yield_agents 等待结果。',
        );
        return lines.join('\n');
      },
    },
    {
      name: 'spawn_agent',
      description: `创建一个子 Agent 来并行处理任务。

何时使用 spawn_agent：
- 任务独立，不依赖当前对话上下文中的中间结果
- 任务需要 3+ 次工具调用（否则自己做更快，spawn 开销约 10s）
- 需要并行执行多个独立任务时

何时不要使用：
- 简单的搜索、读文件、计算 → 直接自己做
- 需要你当前上下文才能完成的任务 → 自己做

创建后请使用 yield_agents 等待结果，不要轮询 list_agents。
收到结果后必须阅读理解，禁止直接转发给用户。`,
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: '子 Agent 要完成的任务描述（要详细，子 Agent 无法访问你的记忆和对话历史）' },
          context: { type: 'string', description: '补充上下文信息（可选，将所需信息直接传入）' },
          timeout: { type: 'number', description: '超时秒数（默认 300，最大 3600）' },
          subagent_type: { type: 'string', enum: ['general', 'researcher', 'writer', 'analyst'], description: '子 Agent 类型: general（通用）、researcher（搜索研究，快速）、writer（内容创作）、analyst（数据分析）。默认 general。' },
          fork: { type: 'boolean', description: '是否 Fork 模式（继承父 Agent 的完整上下文，共享缓存）。默认 false。' },
          mode: { type: 'string', enum: ['run', 'session'], description: 'Spawn 模式: run（一次性，默认）或 session（持久化，可 resume）' },
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
        const subagentType = (args['subagent_type'] as string) ?? 'general';
        const fork = (args['fork'] as boolean) ?? false;
        const mode = (args['mode'] as 'run' | 'session') ?? 'run';
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
            mode,
            agentType: subagentType,
            fork,
          } as any);
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

          let statusLine = `${i + 1}. [${a.status}] ${a.task.slice(0, 100)}${a.task.length > 100 ? '...' : ''}\n   ID: ${a.taskId}`;
          if ((a as any).agentType) statusLine += `  类型: ${(a as any).agentType}`;
          statusLine += `\n   耗时: ${duration}`;

          // 进度追踪
          const progress = (a as any).progress;
          if (progress && a.status === 'running') {
            statusLine += `\n   进度: ${progress.toolUseCount} 次工具调用`;
            if (progress.recentActivities?.length > 0) {
              const recent = progress.recentActivities.map((act: any) => act.toolName).join(' → ');
              statusLine += ` [${recent}]`;
            }
          }

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
        const graceful = (args['graceful'] as boolean) ?? true;
        if (!taskId) return '错误：缺少 taskId 参数';

        const entry = spawner.get(taskId);
        if (!entry) {
          return `未找到 Task ID 为 ${taskId} 的子 Agent。`;
        }
        if (entry.status !== 'running') {
          return `子 Agent ${taskId} 当前状态为 "${entry.status}"，无法终止。`;
        }

        // 优雅关闭：等待 5 秒让子 Agent 完成当前操作
        if (graceful) {
          const waitMs = 5_000;
          // 先给子 Agent 一个缓冲期
          await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 2_000)));
          // 如果已经完成了就不需要 kill
          if (entry.status !== 'running') {
            return `子 Agent ${taskId} 在关闭等待期间已自行完成 (${entry.status})。`;
          }
        }

        const killed = spawner.kill(taskId);
        if (killed) {
          return `子 Agent ${taskId} 已被终止。`;
        }
        return `子 Agent ${taskId} 终止失败。`;
      },
    },
    {
      name: 'steer_agent',
      description: `纠偏一个正在运行的子 Agent。中止当前执行并用纠正指令重新启动，保留原 Task ID。

何时用 steer（而非 kill + spawn）：
- 方向偏差但基本思路对 → steer（保留 Task ID，更方便跟踪）
- 完全走错方向 → kill + spawn（全新开始，避免锚定在失败路径）`,
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
          return `子 Agent 已纠偏。\nTask ID: ${newTaskId}（保持不变）\n纠正指令: ${correction}\n状态: 重新运行中`;
        } catch (err) {
          return `纠偏失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'resume_agent',
      description: `恢复一个 idle 状态的 session 模式子 Agent。仅适用于以 mode:"session" 创建且当前处于 idle 状态的子 Agent。

何时用 resume（而非 spawn 新的）：
- 上一轮结果需要迭代改进 → resume（延续上下文）
- 全新任务 → spawn 新 agent（避免上下文污染）`,
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '要恢复的子 Agent 的 Task ID' },
          followUp: { type: 'string', description: '后续指令（新的任务或补充说明）' },
        },
        required: ['taskId', 'followUp'],
      },
      execute: async (args) => {
        const taskId = args['taskId'] as string;
        const followUp = args['followUp'] as string;

        if (!taskId) return '错误：缺少 taskId 参数';
        if (!followUp) return '错误：缺少 followUp 参数';

        try {
          spawner.resume(taskId, followUp);
          return `子 Agent ${taskId} 已恢复执行。\n后续指令: ${followUp}`;
        } catch (err) {
          return `恢复失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      name: 'yield_agents',
      description:
        '阻塞等待子 Agent 完成（真正的阻塞，非轮询）。\n\n' +
        '调用后当前工具会挂起，最多等待 max_wait_seconds 秒（默认 30，范围 5-120）。\n' +
        '期间任一子 Agent 完成即立即返回结果。\n\n' +
        '使用规则：\n' +
        '- 始终在 spawn_agent / decompose_task 之后调用此工具。\n' +
        '- 若返回 "仍有 N 个运行中"（即等待期内无任一子 Agent 完成），请【立即再次调用 yield_agents】继续等待。\n' +
        '- **严禁改用 list_agents** — 本工具已阻塞等待，list_agents 只会浪费 token 和上下文。\n' +
        '- **严禁输出中间文本**（如"还需等待 N 秒"）— 直接再调 yield_agents。\n' +
        '- 一旦所有子 Agent 完成，工具会返回所有结果 + "所有子 Agent 已完成"标记，此时才能停止等待。',
      parameters: {
        type: 'object',
        properties: {
          max_wait_seconds: {
            type: 'number',
            description: '最大等待秒数（默认 30，范围 5-120）。超时不是错误，只是"本次等待未命中"的信号。',
          },
        },
      },
      execute: async (args, ctx) => {
        // Clamp 到 [5, 120] 秒范围
        const rawMaxWait = typeof args['max_wait_seconds'] === 'number'
          ? args['max_wait_seconds']
          : 30;
        const maxWaitSec = Math.min(Math.max(rawMaxWait, 5), 120);
        const maxWaitMs = maxWaitSec * 1000;

        // 快速路径 1：已有未读取的完成结果 → 立即返回
        let completed = spawner.collectCompletedResults();
        if (completed.length > 0) {
          return formatYieldResult(completed, spawner.hasRunning, spawner.activeCount);
        }

        // 快速路径 2：无运行中的子 Agent
        if (!spawner.hasRunning) {
          return '当前没有运行中的子 Agent，无需等待。';
        }

        // 阻塞等待：任一子 Agent 完成 / 超时 / 外部中断
        try {
          await spawner.awaitNextCompletion({ maxWaitMs, signal: ctx?.signal });
        } catch (err) {
          // AbortError — 主 Agent 被用户中断
          if (err instanceof Error && err.name === 'AbortError') {
            return '等待被中断（用户取消）。';
          }
          throw err;
        }

        // 醒来后再 collect 一次
        completed = spawner.collectCompletedResults();
        if (completed.length > 0) {
          return formatYieldResult(completed, spawner.hasRunning, spawner.activeCount);
        }

        // 超时但未拿到新结果 — 给 LLM 明确指引继续调用（不要改用 list_agents）
        return (
          `已阻塞等待 ${maxWaitSec} 秒，${spawner.activeCount} 个子 Agent 仍在运行中。\n` +
          `请【立即再次调用 yield_agents】继续等待结果。不要改用 list_agents。`
        );
      },
    },
  ];
}
