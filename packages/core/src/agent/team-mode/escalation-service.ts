/**
 * Escalation Service —— 责任链超时升级（M13 PR2）
 *
 * 5 min cron 扫所有 active plan 的任务，按下规则升级：
 *   - 工具调用错重试 2 次后入 needs_help（由 update_task_status 流程承担，不在本服务）
 *   - 15 min 无 status 更新 → stale_marker='yellow_15min' + 提醒 task.created_by
 *   - 30 min 无 status 更新 → stale_marker='red_30min' + 提醒 plan.created_by
 *   - 60 min 无 status 更新 → 群里 @ 原始发起用户
 *   - assignee 被停用（active=false）→ 任务转 stalled + 通知 task.created_by 改派
 *
 * 三跳全是同一个 agent（自派）→ 自动跳过 agent 投递，直接进群提示用户
 *
 * cron 启动方式：上层启动时调 `escalationService.start()` 起一个 setInterval；
 * stop() 在优雅关闭时清理。
 */

import { createLogger } from '../../infrastructure/logger.js';
import { enqueueSystemEvent } from '../../infrastructure/system-events.js';
import type { ChannelManager } from '../../channel/channel-manager.js';
import type { ChannelType } from '@evoclaw/shared';
import type { BindingRouter } from '../../routing/binding-router.js';
import type { AgentManager } from '../agent-manager.js';
import { deriveAssigneeSessionKey, parseGroupSessionKey } from './task-plan/service.js';
import type { TaskPlanService } from './task-plan/service.js';
import type { TaskRow, TaskPlanRow } from './task-plan/types.js';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';

const logger = createLogger('team-mode/escalation');

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const YELLOW_THRESHOLD_MS = 15 * 60 * 1000; // 15 min
const RED_THRESHOLD_MS = 30 * 60 * 1000; // 30 min
const HARD_THRESHOLD_MS = 60 * 60 * 1000; // 60 min

const ACTIVE_TASK_STATUSES = [
  'pending',
  'in_progress',
  'blocked',
  'needs_help',
  'blocked_on_clarification',
];

export interface EscalationServiceDeps {
  store: SqliteStore;
  taskPlanService: TaskPlanService;
  agentManager: AgentManager;
  channelManager: ChannelManager;
  bindingRouter: BindingRouter;
  /** 间隔（默认 5 min，测试可缩短） */
  tickIntervalMs?: number;
  /**
   * N5 修复：每 tick 顺手跑的 GC 钩子（可选）
   * 用于清理 FeishuPeerBotRegistry 等长生命周期 Map 的过期 entry
   */
  gcHooks?: Array<() => void>;
}

export class EscalationService {
  private deps: EscalationServiceDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs: number;
  private running = false;
  /**
   * N2 修复：60min @用户事件去重
   * key=task.id, value=上次 @用户的时间戳（ms）
   * 同一 task 30min 内不重复 @；进程重启 map 清空，最坏情况重启时刚好双触发一次，可接受
   */
  private lastUserNotifiedAt = new Map<string, number>();
  private static readonly USER_NOTIFY_COOLDOWN_MS = 30 * 60_000;

  constructor(deps: EscalationServiceDeps) {
    this.deps = deps;
    this.tickIntervalMs = deps.tickIntervalMs ?? TICK_INTERVAL_MS;
  }

  start(): void {
    if (this.timer !== null) {
      logger.warn('escalation-service 已经启动，忽略重复 start()');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        logger.error('escalation tick 抛错', err);
      });
    }, this.tickIntervalMs);
    if (typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as unknown as { unref: () => void }).unref();
    }
    logger.info(`escalation-service 启动 interval=${this.tickIntervalMs}ms`);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('escalation-service 停止');
    }
  }

  /** 测试 / 手动触发用 */
  async tick(): Promise<void> {
    if (this.running) {
      logger.debug('escalation tick 上一轮还在跑，跳过');
      return;
    }
    this.running = true;
    const startMs = Date.now();
    try {
      const tasks = this.fetchActiveTasksWithPlan();
      let escalations = 0;
      if (tasks.length === 0) {
        logger.debug('escalation tick: 无活跃任务');
      } else {
        logger.debug(`escalation tick: 检查 ${tasks.length} 个活跃任务`);
        for (const { task, plan } of tasks) {
          const escalated = await this.checkTask(task, plan);
          if (escalated) escalations++;
        }
        logger.info(
          `escalation tick 完成 active_tasks=${tasks.length} escalated=${escalations} duration_ms=${Date.now() - startMs}`,
        );
      }
      // N5 修复：每 tick 顺手跑 GC 钩子（peer-bot-registry 过期清理等）
      if (this.deps.gcHooks) {
        for (const hook of this.deps.gcHooks) {
          try {
            hook();
          } catch (err) {
            logger.warn(`gcHook 抛错: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async checkTask(task: TaskRow, plan: TaskPlanRow): Promise<boolean> {
    // 优先检查 assignee 是否还 active
    const assignee = this.deps.agentManager.getAgent(task.assignee_agent_id);
    if (!assignee || assignee.status !== 'active') {
      this.deps.taskPlanService.markStalled(task.id, `assignee ${task.assignee_agent_id} ${assignee?.status ?? 'missing'}`);
      await this.notifyCreator(task, plan, `任务 "${task.title}" 的执行人 ${assignee?.name ?? '(missing)'} 已停用，需要改派或取消`);
      return true;
    }

    const lastUpdate = Date.parse(task.updated_at);
    if (!Number.isFinite(lastUpdate)) return false;
    const idleMs = Date.now() - lastUpdate;

    if (idleMs >= HARD_THRESHOLD_MS) {
      // 60 min：群里 @ 用户。N2 修复：用 lastUserNotifiedAt 节流 30min，避免每个 5min tick 重复 @
      const lastNotified = this.lastUserNotifiedAt.get(task.id) ?? 0;
      const sinceLast = Date.now() - lastNotified;
      if (sinceLast >= EscalationService.USER_NOTIFY_COOLDOWN_MS) {
        await this.notifyUserInGroup(task, plan, idleMs);
        this.lastUserNotifiedAt.set(task.id, Date.now());
        return true;
      } else {
        logger.debug(
          `escalation 第三跳节流跳过 task=${task.id} 距离上次 @用户 ${Math.floor(sinceLast / 60_000)}min < ${EscalationService.USER_NOTIFY_COOLDOWN_MS / 60_000}min`,
        );
      }
    } else if (idleMs >= RED_THRESHOLD_MS) {
      // 30 min：plan.created_by + 标红
      if (task.stale_marker !== 'red_30min') {
        this.deps.taskPlanService.markStaleMarker(task.id, 'red_30min');
        await this.notifyPlanOwner(task, plan, Math.floor(idleMs / 60_000));
        return true;
      }
    } else if (idleMs >= YELLOW_THRESHOLD_MS) {
      // 15 min：task.created_by + 标黄
      if (task.stale_marker === null) {
        this.deps.taskPlanService.markStaleMarker(task.id, 'yellow_15min');
        await this.notifyCreator(task, plan, `任务 "${task.title}" 已 ${Math.floor(idleMs / 60_000)} 分钟没更新，请关注是否需要协助`);
        return true;
      }
    }
    return false;
  }

  /** 第一跳：通知 task.created_by */
  private async notifyCreator(task: TaskRow, plan: TaskPlanRow, message: string): Promise<void> {
    const creatorId = task.created_by_agent_id;
    if (creatorId === task.assignee_agent_id) {
      // 自派 → 跳到 plan.created_by
      logger.debug(`task=${task.id} 自派，跳过第一跳`);
      return this.notifyPlanOwner(task, plan, Math.floor((Date.now() - Date.parse(task.updated_at)) / 60_000));
    }
    const sessionKey = deriveAssigneeSessionKey(plan.group_session_key, creatorId);
    if (!sessionKey) return;
    const text = `<system_event kind="task_stale" task_id="${task.id}">
${message}
plan goal: ${plan.goal}
请考虑：在群里跟进、改派、或调 update_task_status 处理（你是这个任务的派活人）。
</system_event>`;
    enqueueSystemEvent(text, sessionKey, { contextKey: `stale_creator:${task.id}` });
    logger.info(`escalation 第一跳 task=${task.id} → creator=${creatorId}`);
  }

  /** 第二跳：通知 plan.created_by */
  private async notifyPlanOwner(task: TaskRow, plan: TaskPlanRow, idleMin: number): Promise<void> {
    const ownerId = plan.created_by_agent_id;
    if (ownerId === task.assignee_agent_id) {
      // 自派自起 → 跳到第三跳
      logger.debug(`plan=${plan.id} task=${task.id} 自派自起，跳第二跳`);
      return this.notifyUserInGroup(task, plan, idleMin * 60_000);
    }
    const sessionKey = deriveAssigneeSessionKey(plan.group_session_key, ownerId);
    if (!sessionKey) return;
    const assigneeName = this.deps.agentManager.getAgent(task.assignee_agent_id)?.name ?? task.assignee_agent_id;
    const text = `<system_event kind="task_stale_red" plan_id="${plan.id}" task_id="${task.id}">
任务 "${task.title}" 已 ${idleMin} 分钟无进展（assignee: ${assigneeName}）。
plan goal: ${plan.goal}
你是 plan 创建者，请考虑：改派、上报用户或调整 plan 范围。
</system_event>`;
    enqueueSystemEvent(text, sessionKey, { contextKey: `stale_owner:${task.id}` });
    logger.warn(`escalation 第二跳 plan=${plan.id} task=${task.id} → owner=${ownerId} idle_min=${idleMin}`);
  }

  /** 第三跳：群里 @ 原始用户 */
  private async notifyUserInGroup(task: TaskRow, plan: TaskPlanRow, idleMs: number): Promise<void> {
    const parsed = parseGroupSessionKey(plan.group_session_key);
    if (!parsed) return;

    const initiatorUserId = plan.initiator_user_id;
    const idleMin = Math.floor(idleMs / 60_000);
    // 用 plan.created_by 的 binding 把消息发到群里
    const messengerAgentId = plan.created_by_agent_id;

    let accountId: string;
    try {
      const bindings = this.deps.bindingRouter
        .listBindings(messengerAgentId)
        .filter((b) => b.channel === parsed.channelType);
      if (bindings.length === 0) {
        logger.warn(`escalation 第三跳无 binding agent=${messengerAgentId} channel=${parsed.channelType}`);
        return;
      }
      const sorted = [...bindings].sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return b.priority - a.priority;
      });
      accountId = sorted[0].accountId ?? '';
      if (!accountId) {
        logger.warn(`escalation 第三跳 binding 缺 accountId agent=${messengerAgentId}`);
        return;
      }
    } catch (err) {
      logger.error(`escalation 第三跳 binding 解析失败`, err);
      return;
    }

    const userMention = initiatorUserId ? `@${initiatorUserId} ` : '';
    const text = `${userMention}⚠️ 任务卡住超过 ${idleMin} 分钟：${task.title}（plan: ${plan.goal}）。请介入决定后续动作（继续等 / 取消 / 修改需求）。`;
    try {
      await this.deps.channelManager.sendMessage(
        parsed.channelType as ChannelType,
        accountId,
        parsed.chatId,
        text,
        'group',
      );
      logger.error(
        `escalation 第三跳 plan=${plan.id} task=${task.id} → user=${initiatorUserId ?? '(unknown)'} idle_min=${idleMin}`,
      );
    } catch (err) {
      logger.error(`escalation 第三跳 发送失败 plan=${plan.id} task=${task.id}`, err);
    }
  }

  // ─── DB 查询 ────────────────────────────────────────────────

  private fetchActiveTasksWithPlan(): Array<{ task: TaskRow; plan: TaskPlanRow }> {
    const placeholders = ACTIVE_TASK_STATUSES.map(() => '?').join(',');
    const rows = this.deps.store.all<TaskRow & {
      plan_status: 'active' | 'paused' | 'completed' | 'cancelled';
      plan_group_session_key: string;
      plan_channel_type: string;
      plan_goal: string;
      plan_created_by_agent_id: string;
      plan_initiator_user_id: string | null;
      plan_board_card_id: string | null;
      plan_revised_from: string | null;
      plan_created_at: string;
      plan_completed_at: string | null;
    }>(
      // N1 修复：所有 task 列显式 alias 为 task_*，所有 plan 列 alias 为 plan_*。
      // 避免 t.* + p.id 这类 join 中相同列名互相覆盖的隐性陷阱。
      `SELECT t.id AS task_id_col,
              t.plan_id AS task_plan_id,
              t.local_id AS task_local_id,
              t.assignee_agent_id AS task_assignee_agent_id,
              t.created_by_agent_id AS task_created_by_agent_id,
              t.title AS task_title,
              t.description AS task_description,
              t.status AS task_status,
              t.depends_on AS task_depends_on,
              t.output_summary AS task_output_summary,
              t.last_note AS task_last_note,
              t.stale_marker AS task_stale_marker,
              t.created_at AS task_created_at,
              t.started_at AS task_started_at,
              t.completed_at AS task_completed_at,
              t.updated_at AS task_updated_at,
              p.id AS plan_id_col,
              p.status AS plan_status,
              p.group_session_key AS plan_group_session_key,
              p.channel_type AS plan_channel_type,
              p.goal AS plan_goal,
              p.created_by_agent_id AS plan_created_by_agent_id,
              p.initiator_user_id AS plan_initiator_user_id,
              p.board_card_id AS plan_board_card_id,
              p.revised_from AS plan_revised_from,
              p.created_at AS plan_created_at,
              p.completed_at AS plan_completed_at
       FROM tasks t JOIN task_plans p ON p.id = t.plan_id
       WHERE p.status = 'active' AND t.status IN (${placeholders})`,
      ...ACTIVE_TASK_STATUSES,
    );
    return rows.map((r) => ({
      task: extractTaskRow(r as unknown as Record<string, unknown>),
      plan: extractPlanRow(r as unknown as Record<string, unknown>),
    }));
  }
}

function extractTaskRow(r: Record<string, unknown>): TaskRow {
  // N1 修复：从显式 task_* alias 读取（不再依赖 t.* 与 p.* 互不冲突）
  return {
    id: r['task_id_col'] as string,
    plan_id: r['task_plan_id'] as string,
    local_id: r['task_local_id'] as string,
    assignee_agent_id: r['task_assignee_agent_id'] as string,
    created_by_agent_id: r['task_created_by_agent_id'] as string,
    title: r['task_title'] as string,
    description: r['task_description'] as string | null,
    status: r['task_status'] as TaskRow['status'],
    depends_on: r['task_depends_on'] as string,
    output_summary: r['task_output_summary'] as string | null,
    last_note: r['task_last_note'] as string | null,
    stale_marker: r['task_stale_marker'] as TaskRow['stale_marker'],
    created_at: r['task_created_at'] as string,
    started_at: r['task_started_at'] as string | null,
    completed_at: r['task_completed_at'] as string | null,
    updated_at: r['task_updated_at'] as string,
  };
}

function extractPlanRow(r: Record<string, unknown>): TaskPlanRow {
  return {
    id: r['plan_id_col'] as string,
    group_session_key: r['plan_group_session_key'] as string,
    channel_type: r['plan_channel_type'] as string,
    goal: r['plan_goal'] as string,
    created_by_agent_id: r['plan_created_by_agent_id'] as string,
    status: r['plan_status'] as TaskPlanRow['status'],
    board_card_id: r['plan_board_card_id'] as string | null,
    initiator_user_id: r['plan_initiator_user_id'] as string | null,
    revised_from: r['plan_revised_from'] as string | null,
    created_at: r['plan_created_at'] as string,
    completed_at: r['plan_completed_at'] as string | null,
  };
}
