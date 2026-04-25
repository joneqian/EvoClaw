/**
 * Task Plan Builtin Tools —— 4 个跨渠道工具暴露给 Agent（M13 PR2）
 *
 * 工具列表：
 *   - create_task_plan        创建一个含 DAG 的 plan
 *   - update_task_status      assignee 更新自己任务的状态
 *   - list_tasks              查询群里所有 plan / 任务
 *   - request_clarification   缺信息时找 task.created_by
 *
 * 执行上下文：所有工具通过 args 接收 channel-message-handler 自动注入的
 *   - agentId      调用者 Agent ID（即"自己"）
 *   - sessionKey   当前会话 key，形如 "agent:<agentId>:feishu:group:oc_xxx"
 * 工具内部转换为 GroupSessionKey 形如 "feishu:chat:oc_xxx" 供 service 用。
 *
 * 权限语义：
 *   - create_task_plan / list_tasks 全员可调（去 PM 中心化）
 *   - update_task_status 仅 assignee（service 层校验）
 *   - request_clarification 仅 assignee（service 校验 + 工具层 reject）
 */

import type { ToolDefinition } from '../../../bridge/tool-injector.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { enqueueSystemEvent } from '../../../infrastructure/system-events.js';
import { parseSessionKey } from '../../../routing/session-key.js';
import type { TaskPlanService } from './service.js';
import { deriveAssigneeSessionKey } from './service.js';
import { buildGroupSessionKey } from '../group-key-utils.js';
import type {
  CreatePlanTaskInput,
  CreateTaskPlanArgs,
  GroupSessionKey,
  TaskStatus,
} from './types.js';

const logger = createLogger('team-mode/task-plan-tools');

const VALID_TASK_STATUS: ReadonlyArray<TaskStatus> = [
  'pending',
  'in_progress',
  'done',
  'cancelled',
  'blocked',
  'needs_help',
  'blocked_on_clarification',
  'paused',
  'stalled',
];

/**
 * 把 channel-message-handler 注入的 sessionKey 还原成 GroupSessionKey
 * 仅当 chatType === 'group' 时有意义
 *
 * B3 修复：通过 buildGroupSessionKey 剥掉飞书等渠道的 sender/topic 后缀，
 * 否则 group_sender 等隔离模式下，团队 plan 会按 sender 分裂互不可见。
 */
function sessionKeyToGroupKey(sessionKey: string | undefined): GroupSessionKey | null {
  if (!sessionKey) return null;
  const parsed = parseSessionKey(sessionKey);
  if (parsed.chatType !== 'group') return null;
  return buildGroupSessionKey(parsed.channel, parsed.peerId);
}

function getCallerContext(args: Record<string, unknown>): {
  agentId: string;
  groupSessionKey: GroupSessionKey;
} | { error: string } {
  const agentId = args['agentId'];
  const sessionKey = args['sessionKey'];
  if (typeof agentId !== 'string' || !agentId) {
    return { error: '缺少 agentId（应由 channel-message-handler 自动注入）' };
  }
  if (typeof sessionKey !== 'string' || !sessionKey) {
    return { error: '缺少 sessionKey（应由 channel-message-handler 自动注入）' };
  }
  const groupSessionKey = sessionKeyToGroupKey(sessionKey);
  if (!groupSessionKey) {
    return { error: `当前不是群聊会话，无法使用团队模式工具（sessionKey=${sessionKey}）` };
  }
  return { agentId, groupSessionKey };
}

// ─── create_task_plan ────────────────────────────────────────────

export function createTaskPlanTool(svc: TaskPlanService): ToolDefinition {
  return {
    name: 'create_task_plan',
    description:
      '在当前群聊中创建一个团队协作计划（含 DAG 任务）。任何 Agent 都可调用——被 @ 的 Agent 自然成为 plan 的发起人和兜底责任人。计划创建后，无依赖任务的 assignee 会自动收到 task_ready 系统事件。',
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: '总目标，一句话描述用户要做的事。如"做个 H5 落地页"。',
        },
        tasks: {
          type: 'array',
          description: '任务列表（DAG）。每个任务必填 localId/title/assigneeAgentId，可选 description/dependsOn。',
          items: {
            type: 'object',
            properties: {
              localId: {
                type: 'string',
                description: '稳定本地 ID（如 "t1" / "design"），用于在 dependsOn 中引用',
              },
              title: { type: 'string', description: '任务标题' },
              description: { type: 'string', description: '任务详情（可选）' },
              assigneeAgentId: {
                type: 'string',
                description: '指派给的 Agent ID — 必须是 <team_roster> 里 peer 标签的 agent_id（不是 mention_id，也不是 name）',
              },
              dependsOn: {
                type: 'array',
                description: '前置任务的 localId 列表（可空）',
                items: { type: 'string' },
              },
            },
            required: ['localId', 'title', 'assigneeAgentId'],
          },
        },
      },
      required: ['goal', 'tasks'],
    },
    execute: async (args) => {
      const ctx = getCallerContext(args);
      if ('error' in ctx) return `错误：${ctx.error}`;

      const goal = args['goal'];
      const tasks = args['tasks'];
      if (typeof goal !== 'string' || !goal.trim()) return '错误：goal 必填';
      if (!Array.isArray(tasks) || tasks.length === 0) return '错误：tasks 至少 1 项';

      // 收紧入参类型
      const planTasks: CreatePlanTaskInput[] = [];
      for (const t of tasks) {
        if (typeof t !== 'object' || t === null) return '错误：tasks 项不是对象';
        const obj = t as Record<string, unknown>;
        const localId = obj['localId'];
        const title = obj['title'];
        const assigneeAgentId = obj['assigneeAgentId'];
        if (typeof localId !== 'string' || !localId) return '错误：task.localId 必填且为字符串';
        if (typeof title !== 'string' || !title) return '错误：task.title 必填且为字符串';
        if (typeof assigneeAgentId !== 'string' || !assigneeAgentId) {
          return '错误：task.assigneeAgentId 必填且为字符串';
        }
        const description = typeof obj['description'] === 'string' ? (obj['description'] as string) : undefined;
        const dependsOn = Array.isArray(obj['dependsOn'])
          ? (obj['dependsOn'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined;
        planTasks.push({ localId, title, description, assigneeAgentId, dependsOn });
      }

      const initiatorUserId = typeof args['initiatorUserId'] === 'string'
        ? (args['initiatorUserId'] as string)
        : undefined;

      // B6 修复：消费 /revise 留下的 pending revise 上下文
      const { consumePendingRevise } = await import('../user-commands.js');
      const revisedFrom = consumePendingRevise(ctx.groupSessionKey) ?? undefined;

      try {
        const planArgs: CreateTaskPlanArgs = { goal, tasks: planTasks };
        const snapshot = await svc.createPlan(planArgs, {
          groupSessionKey: ctx.groupSessionKey,
          createdByAgentId: ctx.agentId,
          initiatorUserId,
          revisedFrom,
        });
        if (revisedFrom) {
          logger.info(
            `tool create_task_plan auto-linked revised_from=${revisedFrom} new_plan=${snapshot.id}`,
          );
        }
        logger.info(
          `tool create_task_plan ok plan_id=${snapshot.id} agent=${ctx.agentId} ` +
            `tasks=${snapshot.tasks.length}`,
        );
        return formatPlanCreatedResult(snapshot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`tool create_task_plan 失败 agent=${ctx.agentId} err=${msg}`);
        return `错误：${msg}`;
      }
    },
  };
}

function formatPlanCreatedResult(snapshot: import('./types.js').TaskPlanSnapshot): string {
  const lines: string[] = [];
  lines.push(`✅ 已创建计划 plan_id=${snapshot.id}`);
  lines.push(`目标：${snapshot.goal}`);
  lines.push(`任务列表（共 ${snapshot.tasks.length} 项）：`);
  for (const t of snapshot.tasks) {
    const deps = t.dependsOn.length > 0 ? ` 依赖[${t.dependsOn.join(',')}]` : '';
    lines.push(`  - ${t.localId} (${t.status}) "${t.title}" → ${t.assignee.name}${deps}`);
  }

  // 列出已被系统主动 @ 的 assignee（即"无依赖立即 ready 的任务"）
  // 让 LLM 明确知道哪些任务的 @ 已经发出去了，避免重复 @
  const readyAssignees = snapshot.tasks
    .filter((t) => t.dependsOn.length === 0)
    .map((t) => `  - ${t.localId} → ${t.assignee.name}`);

  lines.push('');
  if (readyAssignees.length > 0) {
    lines.push('🔔 系统已自动 @ 以下 assignee（飞书原生 @ + 推送通知已送达）：');
    lines.push(...readyAssignees);
    lines.push('⚠️ 请勿再调 mention_peer @ 这些 assignee（避免双 @）。回复正文怎么组织由你判断。');
  } else {
    lines.push('（本批次无可立即 ready 的任务，依赖完成后系统会自动 @ 下游 assignee）');
  }
  return lines.join('\n');
}

// ─── update_task_status ────────────────────────────────────────

export function createUpdateTaskStatusTool(svc: TaskPlanService): ToolDefinition {
  return {
    name: 'update_task_status',
    description:
      '更新自己名下任务的状态。仅 assignee 可调用。状态：pending/in_progress/done/cancelled/blocked/needs_help/blocked_on_clarification/paused/stalled。状态改 done 时会自动解锁下游依赖。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 DB 主键（UUID），从 list_tasks 获取' },
        status: {
          type: 'string',
          enum: VALID_TASK_STATUS as unknown as string[],
          description: '新状态',
        },
        note: { type: 'string', description: '本次更新备注（可选，会显示在看板上）' },
        outputSummary: {
          type: 'string',
          description: '完成时的产出摘要（status=done 时建议填，会写入数据库）',
        },
      },
      required: ['taskId', 'status'],
    },
    execute: async (args) => {
      const ctx = getCallerContext(args);
      if ('error' in ctx) return `错误：${ctx.error}`;

      const taskId = args['taskId'];
      const status = args['status'];
      if (typeof taskId !== 'string' || !taskId) return '错误：taskId 必填';
      if (typeof status !== 'string' || !VALID_TASK_STATUS.includes(status as TaskStatus)) {
        return `错误：status 非法，合法值：${VALID_TASK_STATUS.join('/')}`;
      }
      const note = typeof args['note'] === 'string' ? (args['note'] as string) : undefined;
      const outputSummary = typeof args['outputSummary'] === 'string'
        ? (args['outputSummary'] as string)
        : undefined;

      const result = svc.updateTaskStatus(
        { taskId, status: status as TaskStatus, note, outputSummary },
        ctx.agentId,
      );
      if (!result.ok) {
        logger.warn(`tool update_task_status reject agent=${ctx.agentId} reason=${result.reason}`);
        return `错误：${result.reason}`;
      }
      logger.info(`tool update_task_status ok agent=${ctx.agentId} task=${taskId} → ${status}`);
      return `已更新任务 ${taskId} 状态为 ${status}${note ? `，备注：${note}` : ''}`;
    },
  };
}

// ─── list_tasks ────────────────────────────────────────────────

export function createListTasksTool(svc: TaskPlanService): ToolDefinition {
  return {
    name: 'list_tasks',
    description:
      '列出当前群里的任务计划及任务状态。任意 Agent 可调用。可选 planId 限定，可选 status=all 含已完成/已取消的（默认仅 active）。',
    parameters: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: '可选：限定 plan_id 只看这一个计划' },
        status: {
          type: 'string',
          enum: ['active', 'all'],
          description: '可选：active=仅活跃计划（默认）；all=全部含已完成/已取消',
        },
      },
    },
    execute: async (args) => {
      const ctx = getCallerContext(args);
      if ('error' in ctx) return `错误：${ctx.error}`;

      const planId = typeof args['planId'] === 'string' ? (args['planId'] as string) : undefined;
      const filter = (typeof args['status'] === 'string' && args['status'] === 'all') ? 'all' as const : 'active' as const;

      const plans = planId
        ? (() => {
            const single = svc.getPlanSnapshot(planId);
            return single ? [single] : [];
          })()
        : svc.listGroupPlans(ctx.groupSessionKey, filter);

      if (plans.length === 0) {
        return planId ? `plan_id=${planId} 未找到` : '当前群没有相关计划';
      }

      const lines: string[] = [];
      for (const p of plans) {
        // 仅展示与当前 group 一致的（双保险）
        if (p.groupSessionKey !== ctx.groupSessionKey) continue;
        lines.push(`plan_id=${p.id} status=${p.status} goal="${p.goal}" by=${p.createdBy.name}`);
        for (const t of p.tasks) {
          const deps = t.dependsOn.length > 0 ? ` 依赖[${t.dependsOn.join(',')}]` : '';
          const stale = t.staleMarker ? ` [${t.staleMarker}]` : '';
          lines.push(`  - ${t.localId} (${t.status})${stale} "${t.title}" → ${t.assignee.name}${deps}`);
          if (t.artifacts.length > 0) {
            for (const a of t.artifacts) {
              lines.push(`      📎 ${a.title} [${a.kind}] ${a.summary.slice(0, 80)}`);
            }
          }
        }
      }
      logger.debug(`tool list_tasks agent=${ctx.agentId} plans=${plans.length}`);
      return lines.join('\n');
    },
  };
}

// ─── request_clarification ─────────────────────────────────────

export function createRequestClarificationTool(svc: TaskPlanService): ToolDefinition {
  return {
    name: 'request_clarification',
    description:
      'assignee 缺信息时调：自动 @ 派活的人（task.created_by），任务状态置为 blocked_on_clarification，等对方回复后再回到 in_progress。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 DB 主键（UUID）' },
        question: { type: 'string', description: '具体追问的问题（中文，越具体越好）' },
      },
      required: ['taskId', 'question'],
    },
    execute: async (args) => {
      const ctx = getCallerContext(args);
      if ('error' in ctx) return `错误：${ctx.error}`;

      const taskId = args['taskId'];
      const question = args['question'];
      if (typeof taskId !== 'string' || !taskId) return '错误：taskId 必填';
      if (typeof question !== 'string' || !question.trim()) return '错误：question 不能为空';

      const found = svc.getTask(taskId);
      if (!found) return `错误：task 不存在 ${taskId}`;

      if (found.task.assignee_agent_id !== ctx.agentId) {
        logger.warn(
          `非 assignee 试图 request_clarification task=${taskId} caller=${ctx.agentId}`,
        );
        return `错误：你不是该任务的 assignee（assignee=${found.task.assignee_agent_id}）`;
      }

      // 先把任务状态置为 blocked_on_clarification
      const updateResult = svc.updateTaskStatus(
        { taskId, status: 'blocked_on_clarification', note: `等待澄清：${question.slice(0, 200)}` },
        ctx.agentId,
      );
      if (!updateResult.ok) {
        return `错误：${updateResult.reason}`;
      }

      // 投递 system event 给 task.created_by
      const targetAgentId = found.task.created_by_agent_id;
      if (targetAgentId === ctx.agentId) {
        // 创建者就是自己，没法问自己，提示用户介入
        logger.warn(
          `request_clarification 派活人就是自己 task=${taskId} agent=${ctx.agentId}，建议用户介入`,
        );
        return `已将任务置为 blocked_on_clarification。但是你既是任务的派活人也是执行人，无法自我澄清，请直接向用户提问。`;
      }
      const targetSessionKey = deriveAssigneeSessionKey(ctx.groupSessionKey, targetAgentId);
      if (!targetSessionKey) {
        return `错误：无法解析目标 sessionKey（group=${ctx.groupSessionKey} target=${targetAgentId}）`;
      }
      const text = `<system_event kind="clarification_request" task_id="${taskId}">
任务 "${found.task.title}" 的执行人 ${ctx.agentId} 需要澄清：
${question}

任务现已置为 blocked_on_clarification，等你回复。
你可以：
  1. 在群里直接回答，或调 mention_peer 工具回复
  2. 回答清楚后，对方会自行恢复 in_progress
  3. 如果是任务范围问题，可以调 update_task_status 改派或取消
</system_event>`;
      enqueueSystemEvent(text, targetSessionKey, {
        contextKey: `clarification:${taskId}`,
      });

      logger.info(
        `request_clarification dispatched task=${taskId} from=${ctx.agentId} to=${targetAgentId}`,
      );
      return `已向派活人发送澄清请求，任务暂停（blocked_on_clarification）。对方回复前请勿继续。`;
    },
  };
}

// ─── 一站式构造 ────────────────────────────────────────────────

/** 一键创建 4 个 task-plan 工具（注入 service 依赖） */
export function createTaskPlanTools(svc: TaskPlanService): ToolDefinition[] {
  return [
    createTaskPlanTool(svc),
    createUpdateTaskStatusTool(svc),
    createListTasksTool(svc),
    createRequestClarificationTool(svc),
  ];
}
