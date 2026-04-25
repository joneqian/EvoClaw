/**
 * User Commands —— 群里用户触发词 /pause /cancel /revise（M13 PR2）
 *
 * 入站钩子：在 channel-message-handler 把消息交给 LLM 之前先识别命令。
 * 命中则短路（不进 LLM），直接调 TaskPlanService 完成动作并发回执。
 *
 * 命令清单：
 *   /pause            暂停当前群所有 active plan
 *   /cancel           取消当前群所有 active plan
 *   /revise <新需求>  保留产物，让 plan 创建者重新拆一版
 *
 * 设计要点：
 *   - 命令必须出现在消息开头（前导空白可忽略）
 *   - /revise 后必须接非空内容
 *   - 命令大小写不敏感
 *   - 用户可在群里发送任何形式（@bot 后接命令也算）— 由 inbound 层提前 strip @
 */

import { createLogger } from '../../infrastructure/logger.js';
import { enqueueSystemEvent } from '../../infrastructure/system-events.js';
import type { TaskPlanService } from './task-plan/service.js';
import { parseGroupSessionKey } from './task-plan/service.js';
import type { GroupSessionKey } from '../../channel/team-mode/team-channel.js';

/** 内联 generateSessionKey，避免 agent → routing 层级违反 */
function generateSessionKey(
  agentId: string,
  channel: string,
  chatType: string,
  peerId: string,
): string {
  return `agent:${agentId}:${channel}:${chatType}:${peerId}`;
}

const logger = createLogger('team-mode/user-commands');

/** 命令类型 */
export type UserCommand =
  | { kind: 'pause' }
  | { kind: 'cancel' }
  | { kind: 'revise'; newGoal: string };

/**
 * 识别命令；不是命令返回 null
 *
 * 大小写不敏感、前导空白忽略、/revise 必须有非空参数
 */
export function parseUserCommand(text: string): UserCommand | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === '/pause' || lower.startsWith('/pause ')) {
    return { kind: 'pause' };
  }
  if (lower === '/cancel' || lower.startsWith('/cancel ')) {
    return { kind: 'cancel' };
  }
  if (lower.startsWith('/revise')) {
    // 取 /revise 之后的全部内容
    const remainder = trimmed.slice('/revise'.length).trim();
    if (!remainder) return null; // /revise 无内容 → 不算命令（让 LLM 处理）
    return { kind: 'revise', newGoal: remainder };
  }
  return null;
}

export interface UserCommandHandlerDeps {
  taskPlanService: TaskPlanService;
}

/**
 * 命令执行结果（供 inbound 层判断是否已短路 + 给用户回复文案）
 */
export interface UserCommandResult {
  /** 是否短路（不再让 LLM 处理） */
  shortCircuit: boolean;
  /** 给用户的回复文案（已经处理时投递到群，shortCircuit=true 时由 caller 发送） */
  replyText: string;
  /** 影响的 plan 数量 */
  affectedPlans: number;
  /** revise 命令时新建的 plan_id */
  newPlanId?: string;
}

export class UserCommandHandler {
  constructor(private deps: UserCommandHandlerDeps) {}

  /**
   * 主入口：尝试识别 + 执行命令
   *
   * @param text                用户消息原文（已 strip @bot）
   * @param groupSessionKey     当前群 session key
   * @param initiatorUserId     原始发起用户 ID
   */
  async handle(
    text: string,
    groupSessionKey: GroupSessionKey,
    initiatorUserId: string | undefined,
  ): Promise<UserCommandResult | null> {
    const cmd = parseUserCommand(text);
    if (!cmd) return null;

    logger.info(
      `用户命令 ${cmd.kind} group=${groupSessionKey} user=${initiatorUserId ?? '(unknown)'}`,
    );

    switch (cmd.kind) {
      case 'pause':
        return this.handlePause(groupSessionKey);
      case 'cancel':
        return this.handleCancel(groupSessionKey);
      case 'revise':
        return this.handleRevise(groupSessionKey, cmd.newGoal, initiatorUserId);
    }
  }

  private async handlePause(groupSessionKey: GroupSessionKey): Promise<UserCommandResult> {
    const plans = this.deps.taskPlanService.listGroupPlans(groupSessionKey, 'active');
    let affectedTasks = 0;
    for (const plan of plans) {
      affectedTasks += this.deps.taskPlanService.pausePlan(plan.id);
    }
    const text = plans.length === 0
      ? '当前群没有活跃的计划可暂停。'
      : `已暂停 ${plans.length} 个计划，影响 ${affectedTasks} 个任务。计划状态保留，用 /revise 修订或继续运行（重新 @ Agent）。`;
    return { shortCircuit: true, replyText: text, affectedPlans: plans.length };
  }

  private async handleCancel(groupSessionKey: GroupSessionKey): Promise<UserCommandResult> {
    const plans = this.deps.taskPlanService.listGroupPlans(groupSessionKey, 'active');
    let affectedTasks = 0;
    for (const plan of plans) {
      affectedTasks += this.deps.taskPlanService.cancelPlan(plan.id);
    }
    const text = plans.length === 0
      ? '当前群没有活跃的计划可取消。'
      : `已取消 ${plans.length} 个计划，终止 ${affectedTasks} 个未完成任务。已完成的产物保留在数据库中可查阅。`;
    return { shortCircuit: true, replyText: text, affectedPlans: plans.length };
  }

  private async handleRevise(
    groupSessionKey: GroupSessionKey,
    newGoal: string,
    initiatorUserId: string | undefined,
  ): Promise<UserCommandResult> {
    const activePlans = this.deps.taskPlanService.listGroupPlans(groupSessionKey, 'active');
    if (activePlans.length === 0) {
      return {
        shortCircuit: true,
        replyText: '当前群没有活跃计划可修订。请直接 @ 一个 Agent 表达新需求。',
        affectedPlans: 0,
      };
    }

    // 取最新一个 active plan 作为修订基准
    const basePlan = activePlans[0];

    // 把它先标 paused（保留），生成新 plan 时由 plan.created_by Agent 重新拆
    this.deps.taskPlanService.pausePlan(basePlan.id);

    // 投递 system event 给 plan 创建者，让其重新拆任务
    const parsed = parseGroupSessionKey(groupSessionKey);
    if (!parsed) {
      logger.warn(`/revise 无法解析 groupSessionKey=${groupSessionKey}`);
      return {
        shortCircuit: true,
        replyText: '错误：无法解析当前会话',
        affectedPlans: 0,
      };
    }
    const targetSessionKey = generateSessionKey(
      basePlan.createdBy.agentId,
      parsed.channelType,
      'group',
      parsed.chatId,
    );

    const eventText = `<system_event kind="plan_revision_requested" plan_id="${basePlan.id}">
用户请求修订当前计划。
原目标：${escape(basePlan.goal)}
原计划状态：${basePlan.status}（已自动暂停）
新需求：${escape(newGoal)}

请重新调用 create_task_plan 生成新计划：
- 复用旧 plan 已完成任务的产出（通过 list_tasks plan_id="${basePlan.id}" 查阅）
- 新 plan 的 revised_from 字段会指向 ${basePlan.id}（系统自动维护）
- 已 done 的 artifact 可通过 fetch_artifact 引用，避免重复劳动
- 投递这条事件的发起人是用户 ${initiatorUserId ?? '(unknown)'}
</system_event>`;
    enqueueSystemEvent(eventText, targetSessionKey, {
      contextKey: `revise:${basePlan.id}`,
    });

    logger.info(
      `/revise 已通知 plan 创建者 plan=${basePlan.id} creator=${basePlan.createdBy.agentId} new_goal_len=${newGoal.length}`,
    );

    return {
      shortCircuit: true,
      replyText: `收到修订需求。已暂停旧计划（plan_id=${basePlan.id}），通知 ${basePlan.createdBy.name} 重新拟定计划，请稍候。`,
      affectedPlans: 1,
    };
  }
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
