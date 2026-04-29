/**
 * Task Plan Service —— Layer 2 任务计划核心服务（M13）
 *
 * 职责：
 * - CRUD：plan / tasks 增删改查
 * - DAG：拓扑排序 + 自环检测 + 多级依赖解锁
 * - 状态变化驱动：每次 update_task_status 后扫描下游，
 *   把就绪任务通过 enqueueSystemEvent 推给 assignee
 * - artifact 元信息读取（attach 由 artifacts/service.ts 负责，
 *   本服务只在 task_ready 系统事件里渲染前置任务的 artifact summary）
 *
 * 责任链字段：
 *   - tasks.created_by_agent_id     谁派的活（第一跳）
 *   - task_plans.created_by_agent_id plan 发起人（第二跳）
 *   - task_plans.initiator_user_id   原始用户（第三跳）
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../../../infrastructure/db/sqlite-store.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { enqueueSystemEvent } from '../../../infrastructure/system-events.js';
import { generateSessionKey } from '../../../routing/session-key.js';
import type { AgentManager } from '../../agent-manager.js';
import type { LoopGuard } from '../loop-guard.js';
import type {
  ArtifactKind,
  CreatePlanTaskInput,
  CreateTaskPlanArgs,
  GroupSessionKey,
  PlanStatus,
  TaskArtifactRow,
  TaskNodeSnapshot,
  TaskPlanRow,
  TaskPlanSnapshot,
  TaskRow,
  UpdateTaskStatusArgs,
} from './types.js';

const logger = createLogger('team-mode/task-plan');

/**
 * 解析 GroupSessionKey 形如 "feishu:chat:oc_xxx" → { channelType: 'feishu', chatId: 'oc_xxx' }
 *
 * 用于把 group_session_key 还原成 (channel, peerId)，再 join assigneeAgentId
 * 构造目标 Agent 的 sessionKey 投递 system event。
 */
export function parseGroupSessionKey(
  key: GroupSessionKey,
): { channelType: string; chatId: string } | null {
  // 形如 "feishu:chat:oc_xxx" / "ilink:room:wr_xxx" / "discord:guild:1:channel:5"
  const idx1 = key.indexOf(':');
  if (idx1 <= 0) return null;
  const channelType = key.slice(0, idx1);
  const idx2 = key.indexOf(':', idx1 + 1);
  if (idx2 < 0) return null;
  // 跨过 "chat" / "room" 等子类型分段，剩余整段作为 chatId
  const chatId = key.slice(idx2 + 1);
  if (!chatId) return null;
  return { channelType, chatId };
}

/** 把 group session key + assigneeAgentId 拼成目标 Agent 的完整 SessionKey */
export function deriveAssigneeSessionKey(
  groupSessionKey: GroupSessionKey,
  assigneeAgentId: string,
): string | null {
  const parsed = parseGroupSessionKey(groupSessionKey);
  if (!parsed) return null;
  return generateSessionKey(assigneeAgentId, parsed.channelType, 'group', parsed.chatId);
}

/**
 * 任务就绪通知器（M13 多 Agent @ 死锁修复）
 *
 * 责任：在 dispatchReadyTasks 把 task_ready system event 入队后，**主动**通过渠道
 * 原生 @ 把任务推送给 assignee。原先 enqueueSystemEvent 只是被动队列（要等 assignee
 * 自然收到下一条入站消息才会被 drain），冷启动场景下永远不会被触发，导致协作死锁。
 *
 * 实现：server.ts 装配（teamChannelRegistry + channelManager + bindingRouter）。
 * 失败 / 找不到 adapter 时静默吞错，不阻塞 plan 创建主流程。
 */
export interface TaskReadyNotifier {
  notifyTaskReady(args: {
    plan: TaskPlanSnapshot;
    task: TaskNodeSnapshot;
    /** 谁触发的派活 — 用于日志 + 责任链文案 */
    triggeredByAgentId: string;
  }): Promise<void>;
}

/**
 * 任务完成广播器（M13 修复 — 解决"先派活后宣告"错位）
 *
 * 触发时机：assignee 调 update_task_status('done') → service 在 dispatchReadyTasks 之前
 * 用 task.assignee.agentId 的身份在群里发一条人话宣告（含 outputSummary + 本任务 artifacts），
 * 这样下游派活通知出现时，群里已经能看到上游 assignee 自己署名的"完成宣告"。
 *
 * 设计要点：
 *   - 用 assignee 身份发，保留 Agent 人格（emoji + 名字署名）
 *   - 内容来自 outputSummary（assignee 自己写的人话），不做二次改写
 *   - 失败 fire-and-forget 不阻塞 dispatchReadyTasks（与 notifier 一致）
 */
export interface TaskCompletedAnnouncer {
  announceTaskCompleted(args: {
    plan: TaskPlanSnapshot;
    task: TaskNodeSnapshot;
    /** assignee 在 update_task_status 工具入参里写的产出摘要（人话） */
    outputSummary: string;
  }): Promise<void>;
}

export interface TaskPlanServiceDeps {
  store: SqliteStore;
  agentManager: AgentManager;
  loopGuard?: LoopGuard;
  /** 任务就绪 → 主动 @ assignee（M13 修复，可选；不注入时退化为旧 system event 模式） */
  taskReadyNotifier?: TaskReadyNotifier;
  /** 任务完成 → 用 assignee 身份在群里宣告（M13 修复"先派活后宣告"错位，可选） */
  taskCompletedAnnouncer?: TaskCompletedAnnouncer;
}

/** 创建 plan 时的辅助上下文（无法塞进 args） */
export interface CreatePlanContext {
  /** 当前 group 会话 key */
  groupSessionKey: GroupSessionKey;
  /** 谁创建的 plan（被 @ 的那个 Agent） */
  createdByAgentId: string;
  /** 原始发起用户（用于责任链最后一跳） */
  initiatorUserId?: string;
  /** /revise 链接的上一版 plan（B6 修复：可被外部直接传入） */
  revisedFrom?: string;
}

/**
 * 看板回调（M13 PR5-B4）
 *
 * - 首次发卡：existingCardId=null → 返回新 cardId，service 写回 task_plans.board_card_id
 * - 状态变化：传入已有 cardId → adapter 决定原地更新或发新条
 * 失败时 service 静默吞错（仅 log），不阻塞主流程
 */
export type BoardSink = (
  plan: TaskPlanSnapshot,
  existingCardId: string | null,
) => Promise<{ cardId: string }>;

/** refreshBoard debounce 窗口（300 ms）— 同 plan 在窗口内的多次刷新合并为一次实际触发 */
export const BOARD_REFRESH_DEBOUNCE_MS = 300;

export class TaskPlanService {
  private store: SqliteStore;
  private agentManager: AgentManager;
  private loopGuard?: LoopGuard;
  private boardSink: BoardSink | null = null;
  private taskReadyNotifier: TaskReadyNotifier | null = null;
  private taskCompletedAnnouncer: TaskCompletedAnnouncer | null = null;
  /**
   * refreshBoard per-plan debounce timers（M13 修复 — 解决"密集状态变化连发多张看板"）
   *
   * 同一个 planId 在 BOARD_REFRESH_DEBOUNCE_MS 窗口内的多次刷新只触发最后一次实际发卡。
   * 典型场景：t1 done 解锁了 t2/t3，UI/UX 和架构师几乎同时调 update_task_status('in_progress')，
   * 旧逻辑会连发 3 张看板，debounce 后合并成 1 张。
   *
   * 注：debounce 是"trailing edge"语义——窗口期内每次新 refresh 都重置 timer，最后一次到点才发。
   */
  private boardRefreshTimers = new Map<string, NodeJS.Timeout>();
  /** 测试可设为 0 关闭 debounce（避免 vitest fake timer 复杂度） */
  private boardRefreshDebounceMs: number;

  constructor(deps: TaskPlanServiceDeps & { boardRefreshDebounceMs?: number }) {
    this.store = deps.store;
    this.agentManager = deps.agentManager;
    this.loopGuard = deps.loopGuard;
    this.taskReadyNotifier = deps.taskReadyNotifier ?? null;
    this.taskCompletedAnnouncer = deps.taskCompletedAnnouncer ?? null;
    this.boardRefreshDebounceMs = deps.boardRefreshDebounceMs ?? BOARD_REFRESH_DEBOUNCE_MS;
  }

  /** 注入任务就绪通知器（server.ts 装配，迟到注入兼容旧路径） */
  setTaskReadyNotifier(notifier: TaskReadyNotifier): void {
    this.taskReadyNotifier = notifier;
  }

  /** 注入任务完成广播器（server.ts 装配，迟到注入兼容旧路径） */
  setTaskCompletedAnnouncer(announcer: TaskCompletedAnnouncer): void {
    this.taskCompletedAnnouncer = announcer;
  }

  /** 注入看板回调（server.ts 装配时调）。未注入时看板不发，service 静默 */
  setBoardSink(sink: BoardSink): void {
    this.boardSink = sink;
  }

  /**
   * 刷新看板（带 per-plan debounce）
   *
   * 调用契约不变：caller 仍 `void this.refreshBoard(planId)` fire-and-forget；
   * 内部把"立刻发卡"改成"在 BOARD_REFRESH_DEBOUNCE_MS 后发，期间被 reset 则推迟"。
   * 返回的 Promise 立即 resolve（debounce 安排完即返回），不等真实发送。
   */
  private async refreshBoard(planId: string): Promise<void> {
    if (!this.boardSink) return;

    // debounce=0 → 同步走旧逻辑（测试用）
    if (this.boardRefreshDebounceMs === 0) {
      await this.doRefreshBoard(planId);
      return;
    }

    // 已有 pending → 重置 timer（trailing edge）
    const pending = this.boardRefreshTimers.get(planId);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      this.boardRefreshTimers.delete(planId);
      // 不 await — 让 timer 回调即时返回，发卡异常已在 doRefreshBoard 内吞掉
      void this.doRefreshBoard(planId);
    }, this.boardRefreshDebounceMs);
    this.boardRefreshTimers.set(planId, timer);
  }

  /** 内部：实际发卡逻辑（不含 debounce） */
  private async doRefreshBoard(planId: string): Promise<void> {
    if (!this.boardSink) return;
    const snap = this.getPlanSnapshot(planId);
    if (!snap) return;
    const existingCardId = this.store.get<{ board_card_id: string | null }>(
      `SELECT board_card_id FROM task_plans WHERE id = ?`,
      planId,
    )?.board_card_id ?? null;
    try {
      const result = await this.boardSink(snap, existingCardId);
      if (result.cardId && result.cardId !== existingCardId) {
        this.store.run(
          `UPDATE task_plans SET board_card_id = ? WHERE id = ?`,
          result.cardId,
          planId,
        );
      }
    } catch (err) {
      logger.warn(
        `refreshBoard 失败 plan=${planId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 优雅关闭：刷新所有 pending board refresh timer
   *
   * 调用方：server.ts 优雅关闭路径。让 in-flight 的 debounce timer 立即触发实际发卡，
   * 避免最后一次状态变更的看板永远不发。
   */
  flushPendingBoardRefreshes(): void {
    const planIds = Array.from(this.boardRefreshTimers.keys());
    for (const planId of planIds) {
      const timer = this.boardRefreshTimers.get(planId);
      if (timer) clearTimeout(timer);
      this.boardRefreshTimers.delete(planId);
      void this.doRefreshBoard(planId);
    }
  }

  // ─── Plan CRUD ────────────────────────────────────────────────

  /**
   * 创建一个 plan + 全部 tasks
   *
   * 校验：
   *   - tasks.length >= 1
   *   - localId 唯一
   *   - assigneeAgentId 存在且 active
   *   - dependsOn 引用的 localId 必须在同 plan 内
   *   - DAG 无环
   *
   * 副作用：对所有"无依赖"任务发 task_ready system event
   *
   * @returns 新建 plan 的快照
   */
  async createPlan(
    args: CreateTaskPlanArgs,
    ctx: CreatePlanContext,
  ): Promise<TaskPlanSnapshot> {
    if (!args.goal || args.goal.trim().length === 0) {
      throw new Error('goal 不能为空');
    }
    if (!args.tasks || args.tasks.length === 0) {
      throw new Error('tasks 不能为空');
    }

    // 校验 localId 唯一
    const localIds = new Set<string>();
    for (const t of args.tasks) {
      if (!t.localId) throw new Error('task.localId 必填');
      if (localIds.has(t.localId)) throw new Error(`task.localId 重复: ${t.localId}`);
      localIds.add(t.localId);
    }

    // 校验 dependsOn 引用 + DAG 无环
    for (const t of args.tasks) {
      for (const dep of t.dependsOn ?? []) {
        if (!localIds.has(dep)) {
          throw new Error(`task ${t.localId} 依赖未知任务 ${dep}`);
        }
      }
    }
    detectCycle(args.tasks);

    // 校验 assignee active
    for (const t of args.tasks) {
      const agent = this.agentManager.getAgent(t.assigneeAgentId);
      if (!agent) throw new Error(`assignee 不存在: ${t.assigneeAgentId}`);
      if (agent.status !== 'active') {
        throw new Error(`assignee ${agent.name}(${t.assigneeAgentId}) 当前状态 ${agent.status}，无法接活`);
      }
    }

    // 校验 createdBy 存在
    const creator = this.agentManager.getAgent(ctx.createdByAgentId);
    if (!creator) throw new Error(`createdBy 不存在: ${ctx.createdByAgentId}`);

    // 解析 channel
    const parsed = parseGroupSessionKey(ctx.groupSessionKey);
    if (!parsed) throw new Error(`无效 group_session_key: ${ctx.groupSessionKey}`);

    const planId = crypto.randomUUID();
    const now = new Date().toISOString();

    // 插入 plan
    // B6 修复：revised_from 来自 ctx.revisedFrom（/revise 命令带过来），
    // 之前硬编码 NULL → 修订链路丢失
    this.store.run(
      `INSERT INTO task_plans
       (id, group_session_key, channel_type, goal, created_by_agent_id, status,
        board_card_id, initiator_user_id, revised_from, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL)`,
      planId,
      ctx.groupSessionKey,
      parsed.channelType,
      args.goal.trim(),
      ctx.createdByAgentId,
      ctx.initiatorUserId ?? null,
      ctx.revisedFrom ?? null,
      now,
    );

    // 插入 tasks
    for (const t of args.tasks) {
      const taskId = crypto.randomUUID();
      // M13 工作流懒加载：expectedArtifactKinds 落 expected_artifact_kinds 列。
      // 软约束：未声明 → null；声明空数组也存 null（语义等价"未声明"）
      const expectedKindsJson =
        Array.isArray(t.expectedArtifactKinds) && t.expectedArtifactKinds.length > 0
          ? JSON.stringify(t.expectedArtifactKinds)
          : null;
      this.store.run(
        `INSERT INTO tasks
         (id, plan_id, local_id, assignee_agent_id, created_by_agent_id,
          title, description, status, depends_on, output_summary, last_note,
          stale_marker, created_at, started_at, completed_at, updated_at,
          expected_artifact_kinds)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
        taskId,
        planId,
        t.localId,
        t.assigneeAgentId,
        ctx.createdByAgentId,
        t.title,
        t.description ?? null,
        JSON.stringify(t.dependsOn ?? []),
        now,
        now,
        expectedKindsJson,
      );
    }

    logger.info(
      `创建 plan id=${planId} group=${ctx.groupSessionKey} createdBy=${ctx.createdByAgentId} ` +
        `goal="${args.goal.slice(0, 80)}" tasks=${args.tasks.length}`,
    );

    // 触发首批就绪任务（depends_on 为空的）
    const snapshot = this.getPlanSnapshot(planId);
    if (!snapshot) throw new Error('plan 创建后查询失败（不应发生）');
    this.dispatchReadyTasks(snapshot, /* triggeredBy */ ctx.createdByAgentId);

    // B4 修复：plan 创建后立即发看板卡片（fire-and-forget，失败不阻塞）
    void this.refreshBoard(planId);

    return snapshot;
  }

  /** 更新 plan 状态（用于 /pause /cancel /completed） */
  setPlanStatus(planId: string, status: PlanStatus, reason?: string): void {
    const completedAt = status === 'completed' || status === 'cancelled'
      ? new Date().toISOString()
      : null;
    this.store.run(
      `UPDATE task_plans SET status = ?, completed_at = ? WHERE id = ?`,
      status,
      completedAt,
      planId,
    );
    logger.info(`plan 状态 ${planId} → ${status}${reason ? ` (${reason})` : ''}`);
    // B4 修复：plan 状态变化刷新看板
    void this.refreshBoard(planId);
  }

  /**
   * 暂停一个 plan：把所有 in_progress / pending 任务标 paused
   * 已 done / cancelled 的任务保持原状
   */
  pausePlan(planId: string): number {
    this.setPlanStatus(planId, 'paused');
    const result = this.store.run(
      `UPDATE tasks SET status = 'paused', updated_at = ?
       WHERE plan_id = ? AND status IN ('pending', 'in_progress', 'blocked', 'needs_help', 'blocked_on_clarification')`,
      new Date().toISOString(),
      planId,
    );
    logger.info(`pausePlan plan_id=${planId} affected_tasks=${result.changes ?? 0}`);
    return result.changes ?? 0;
  }

  /**
   * 取消一个 plan：所有未 done 任务标 cancelled
   */
  cancelPlan(planId: string): number {
    this.setPlanStatus(planId, 'cancelled');
    const result = this.store.run(
      `UPDATE tasks SET status = 'cancelled', updated_at = ?, completed_at = ?
       WHERE plan_id = ? AND status NOT IN ('done', 'cancelled')`,
      new Date().toISOString(),
      new Date().toISOString(),
      planId,
    );
    logger.info(`cancelPlan plan_id=${planId} affected_tasks=${result.changes ?? 0}`);
    return result.changes ?? 0;
  }

  /**
   * 列出某个群里所有 active plan（按创建时间倒序）
   *
   * 如果传 status='all' 则列出所有状态，否则只列 active。
   */
  listGroupPlans(
    groupSessionKey: GroupSessionKey,
    status: PlanStatus | 'all' = 'active',
  ): TaskPlanSnapshot[] {
    const rows = status === 'all'
      ? this.store.all<TaskPlanRow>(
          `SELECT * FROM task_plans WHERE group_session_key = ? ORDER BY created_at DESC`,
          groupSessionKey,
        )
      : this.store.all<TaskPlanRow>(
          `SELECT * FROM task_plans WHERE group_session_key = ? AND status = ? ORDER BY created_at DESC`,
          groupSessionKey,
          status,
        );
    return rows.map((row) => this.assemblePlanFromRow(row));
  }

  /**
   * 列出 assignee 名下未完成任务（不分群，给 prompt-fragment 用）
   */
  listOpenTasksForAssignee(assigneeAgentId: string, groupSessionKey: GroupSessionKey): TaskNodeSnapshot[] {
    const rows = this.store.all<TaskRow & { plan_group_session_key: string }>(
      `SELECT t.*, p.group_session_key AS plan_group_session_key
       FROM tasks t JOIN task_plans p ON p.id = t.plan_id
       WHERE t.assignee_agent_id = ?
         AND p.group_session_key = ?
         AND p.status = 'active'
         AND t.status NOT IN ('done', 'cancelled', 'paused', 'stalled')
       ORDER BY t.created_at ASC`,
      assigneeAgentId,
      groupSessionKey,
    );
    return rows.map((r) => this.taskRowToNodeSnapshot(r));
  }

  /** 取 plan 快照（含全部 tasks 和 artifact summaries） */
  getPlanSnapshot(planId: string): TaskPlanSnapshot | null {
    const planRow = this.store.get<TaskPlanRow>(
      `SELECT * FROM task_plans WHERE id = ?`,
      planId,
    );
    if (!planRow) return null;
    return this.assemblePlanFromRow(planRow);
  }

  /** 取单个 task（含 plan 引用，方便上层做权限校验） */
  getTask(taskId: string): { task: TaskRow; plan: TaskPlanRow } | null {
    const task = this.store.get<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, taskId);
    if (!task) return null;
    const plan = this.store.get<TaskPlanRow>(`SELECT * FROM task_plans WHERE id = ?`, task.plan_id);
    if (!plan) return null;
    return { task, plan };
  }

  // ─── Status 变化 ──────────────────────────────────────────────

  /**
   * 更新任务状态
   *
   * 校验：updater === assignee_agent_id（只允许 assignee 改自己任务）
   * 副作用：
   *   - status === 'done' → 扫下游，触发就绪任务的 system event
   *   - status === 'needs_help' → 通知 task.created_by（responsibility chain 第一跳）
   *   - 通知 LoopGuard 清乒乓累积
   */
  updateTaskStatus(
    args: UpdateTaskStatusArgs,
    updaterAgentId: string,
  ): { ok: true; taskId: string } | { ok: false; reason: string } {
    const found = this.getTask(args.taskId);
    if (!found) return { ok: false, reason: `task 不存在: ${args.taskId}` };

    if (found.task.assignee_agent_id !== updaterAgentId) {
      logger.warn(
        `非 assignee 试图改任务 task=${args.taskId} updater=${updaterAgentId} ` +
          `assignee=${found.task.assignee_agent_id}`,
      );
      return {
        ok: false,
        reason: `只有 assignee（${found.task.assignee_agent_id}）能更新此任务状态，你是 ${updaterAgentId}`,
      };
    }

    const now = new Date().toISOString();
    const startedAt = args.status === 'in_progress' && !found.task.started_at ? now : found.task.started_at;
    const completedAt = args.status === 'done' || args.status === 'cancelled' ? now : found.task.completed_at;

    this.store.run(
      `UPDATE tasks SET status = ?, last_note = ?, output_summary = ?, started_at = ?, completed_at = ?,
                       stale_marker = NULL, updated_at = ?
       WHERE id = ?`,
      args.status,
      args.note ?? null,
      args.outputSummary ?? found.task.output_summary,
      startedAt,
      completedAt,
      now,
      args.taskId,
    );

    logger.info(
      `task ${args.taskId} (${found.task.local_id}) ${found.task.status} → ${args.status} by ${updaterAgentId}`,
    );

    // 通知 loop-guard 清乒乓累积（任务有进展，不是死循环）
    this.loopGuard?.notifyTaskStatusChanged(args.taskId);

    // 副作用：根据新状态触发后续动作
    const planSnapshot = this.getPlanSnapshot(found.plan.id);
    if (!planSnapshot) return { ok: true, taskId: args.taskId };

    if (args.status === 'done') {
      // M13 修复（"先派活后宣告"错位）：在 dispatchReadyTasks 之前先广播完成宣告，
      // 用 assignee 身份把 outputSummary 发到群里。这样下游派活通知出现时，
      // 群里已经能看到上游 assignee 的完成宣告，时序自洽。
      // fire-and-forget — 失败不阻塞派活主流程
      this.dispatchTaskCompletedAnnouncement(planSnapshot, updaterAgentId, args.outputSummary);

      // 扫下游：检查整个 plan 是否完成
      const allDone = planSnapshot.tasks.every((t) => t.status === 'done' || t.status === 'cancelled');
      if (allDone) {
        // setPlanStatus 内部会调 refreshBoard
        this.setPlanStatus(found.plan.id, 'completed', 'all tasks done');
        this.dispatchPlanCompletedEvent(planSnapshot, updaterAgentId);
      } else {
        // 继续解锁就绪的下游
        this.dispatchReadyTasks(planSnapshot, updaterAgentId);
        // B4 修复：状态变化刷新看板
        void this.refreshBoard(found.plan.id);
      }
    } else if (args.status === 'needs_help') {
      this.dispatchNeedsHelpEvent(planSnapshot, found.task, updaterAgentId, args.note);
      void this.refreshBoard(found.plan.id);
    } else {
      // 其他状态变化（in_progress / blocked / blocked_on_clarification 等）也刷
      void this.refreshBoard(found.plan.id);
    }

    return { ok: true, taskId: args.taskId };
  }

  /**
   * 标记任务进入 stalled 状态（用于 escalation-service 检测 assignee 被停用）
   */
  markStalled(taskId: string, reason: string): void {
    const found = this.getTask(taskId);
    if (!found) return;
    if (['done', 'cancelled', 'stalled'].includes(found.task.status)) return;
    this.store.run(
      `UPDATE tasks SET status = 'stalled', last_note = ?, updated_at = ? WHERE id = ?`,
      `[stalled] ${reason}`,
      new Date().toISOString(),
      taskId,
    );
    logger.warn(`task ${taskId} 标记 stalled: ${reason}`);
  }

  /** 标记 task stale_marker（escalation-service 写） */
  markStaleMarker(taskId: string, marker: 'yellow_15min' | 'red_30min' | null): void {
    this.store.run(
      `UPDATE tasks SET stale_marker = ? WHERE id = ?`,
      marker,
      taskId,
    );
  }

  // ─── 系统事件分派 ────────────────────────────────────────────

  /**
   * 扫描 plan，把所有"依赖已就绪 + 仍 pending"的任务投递给 assignee
   *
   * @param triggeredBy 谁的动作触发的（用于日志 + 事件文案）
   */
  private dispatchReadyTasks(plan: TaskPlanSnapshot, triggeredBy: string): void {
    const taskByLocalId = new Map<string, TaskNodeSnapshot>();
    for (const t of plan.tasks) taskByLocalId.set(t.localId, t);

    let dispatched = 0;
    for (const task of plan.tasks) {
      if (task.status !== 'pending' && task.status !== 'blocked') continue;
      const allDepsDone = task.dependsOn.every((depId) => {
        const dep = taskByLocalId.get(depId);
        return dep && dep.status === 'done';
      });
      if (!allDepsDone) continue;

      const assigneeKey = deriveAssigneeSessionKey(plan.groupSessionKey, task.assignee.agentId);
      if (!assigneeKey) {
        logger.warn(`无法派生 assignee sessionKey task=${task.localId} assignee=${task.assignee.agentId}`);
        continue;
      }

      const text = renderTaskReadyEvent(plan, task, taskByLocalId);
      enqueueSystemEvent(text, assigneeKey, {
        contextKey: `task_ready:${plan.id}:${task.localId}`,
      });

      logger.info(
        `task_ready event dispatched plan=${plan.id} task=${task.localId} ` +
          `assignee=${task.assignee.agentId} sessionKey=${assigneeKey}`,
      );

      // M13 修复：主动通过渠道原生 @ 推送给 assignee，不依赖被动 drain。
      // fire-and-forget — 通知失败不阻塞 plan 主流程，错误已在 notifier 内记日志。
      if (this.taskReadyNotifier) {
        const notifier = this.taskReadyNotifier;
        notifier
          .notifyTaskReady({ plan, task, triggeredByAgentId: triggeredBy })
          .catch((err) => {
            logger.warn(
              `taskReadyNotifier 未捕获异常 plan=${plan.id} task=${task.localId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      } else {
        logger.debug(
          `taskReadyNotifier 未注入，task_ready 仅入队 system event plan=${plan.id} task=${task.localId}`,
        );
      }
      dispatched++;
    }

    if (dispatched === 0) {
      logger.debug(`dispatchReadyTasks plan=${plan.id} 无新就绪任务 (triggered=${triggeredBy})`);
    }
  }

  /**
   * 任务完成宣告（M13 修复 — 解决"先派活后宣告"错位）
   *
   * 在 dispatchReadyTasks 之前调用。委托给 announcer 用 assignee 身份在群里广播
   * outputSummary（含 artifact 摘要）。fire-and-forget，失败不阻塞派活。
   *
   * outputSummary 为空时跳过——宁可不发，也不发"X 完成了"这种空洞的机械消息
   * （这种情况下工具层已 fail-fast 拒绝，理论上不会走到这里）。
   */
  private dispatchTaskCompletedAnnouncement(
    plan: TaskPlanSnapshot,
    assigneeAgentId: string,
    outputSummary: string | undefined,
  ): void {
    if (!this.taskCompletedAnnouncer) {
      logger.debug(
        `taskCompletedAnnouncer 未注入，跳过完成宣告 plan=${plan.id} assignee=${assigneeAgentId}`,
      );
      return;
    }
    const summary = (outputSummary ?? '').trim();
    if (!summary) {
      logger.debug(
        `outputSummary 为空，跳过完成宣告 plan=${plan.id} assignee=${assigneeAgentId}`,
      );
      return;
    }
    const task = plan.tasks.find((t) => t.assignee.agentId === assigneeAgentId && t.status === 'done');
    if (!task) {
      logger.warn(
        `dispatchTaskCompletedAnnouncement 找不到 done 任务 plan=${plan.id} assignee=${assigneeAgentId}`,
      );
      return;
    }
    const announcer = this.taskCompletedAnnouncer;
    announcer
      .announceTaskCompleted({ plan, task, outputSummary: summary })
      .catch((err) => {
        logger.warn(
          `taskCompletedAnnouncer 未捕获异常 plan=${plan.id} task=${task.localId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * needs_help 事件：通知 task.created_by（责任链第一跳）
   */
  private dispatchNeedsHelpEvent(
    plan: TaskPlanSnapshot,
    task: TaskRow,
    assigneeAgentId: string,
    note: string | undefined,
  ): void {
    // 第一跳：task.created_by。若就是 assignee 自己，跳到 plan.created_by
    let target = task.created_by_agent_id;
    if (target === assigneeAgentId) {
      target = plan.createdBy.agentId;
      if (target === assigneeAgentId) {
        // 第三跳：用户。但 system event 没法直接 @ 用户，留给 escalation cron 处理
        logger.warn(
          `needs_help 三跳全是自己 task=${task.id} assignee=${assigneeAgentId}，跳过 agent 投递（待 escalation-service @ 原始用户）`,
        );
        return;
      }
    }

    const targetSessionKey = deriveAssigneeSessionKey(plan.groupSessionKey, target);
    if (!targetSessionKey) {
      logger.warn(`needs_help 无法派生 sessionKey target=${target}`);
      return;
    }

    const assignee = this.agentManager.getAgent(assigneeAgentId);
    const assigneeName = assignee?.name ?? assigneeAgentId;
    const text = `<needs_help task_id="${task.id}" task="${escape(task.title)}" assignee="${escape(assigneeName)}">
${assigneeName} 在任务 "${task.title}" 上请求帮助${note ? `：${note}` : ''}。
plan goal: ${plan.goal}
你是这个任务的派活人，请评估如何处理（提供帮助 / 改派 / 升级到 plan.created_by）。
</needs_help>`;

    enqueueSystemEvent(text, targetSessionKey, {
      contextKey: `needs_help:${task.id}`,
    });
    logger.info(
      `needs_help event dispatched plan=${plan.id} task=${task.id} target=${target} assignee=${assigneeAgentId}`,
    );
  }

  /**
   * plan 完成事件：通知 plan.created_by 汇报
   */
  private dispatchPlanCompletedEvent(plan: TaskPlanSnapshot, triggeredBy: string): void {
    const target = plan.createdBy.agentId;
    if (target === triggeredBy) {
      logger.debug(`plan_completed 触发者就是 plan 创建者，跳过 event（自己已知）plan=${plan.id}`);
      return;
    }
    const sessionKey = deriveAssigneeSessionKey(plan.groupSessionKey, target);
    if (!sessionKey) return;

    const text = `<plan_completed plan_id="${plan.id}">
计划 "${escape(plan.goal)}" 全部任务已完成，请汇总向用户汇报。
</plan_completed>`;
    enqueueSystemEvent(text, sessionKey, {
      contextKey: `plan_completed:${plan.id}`,
    });
    logger.info(`plan_completed event dispatched plan=${plan.id} → ${target}`);
  }

  // ─── 内部装配 ────────────────────────────────────────────────

  private assemblePlanFromRow(row: TaskPlanRow): TaskPlanSnapshot {
    const taskRows = this.store.all<TaskRow>(
      `SELECT * FROM tasks WHERE plan_id = ? ORDER BY created_at ASC`,
      row.id,
    );
    const artifactRows = this.store.all<TaskArtifactRow>(
      `SELECT * FROM task_artifacts WHERE plan_id = ? ORDER BY created_at DESC`,
      row.id,
    );
    const artifactsByTaskId = new Map<string, TaskArtifactRow[]>();
    for (const art of artifactRows) {
      const list = artifactsByTaskId.get(art.task_id);
      if (list) list.push(art);
      else artifactsByTaskId.set(art.task_id, [art]);
    }

    const tasks = taskRows.map((tr) => this.taskRowToNodeSnapshot(tr, artifactsByTaskId.get(tr.id) ?? []));
    const creatorAgent = this.agentManager.getAgent(row.created_by_agent_id);

    return {
      id: row.id,
      groupSessionKey: row.group_session_key,
      channelType: row.channel_type,
      goal: row.goal,
      status: row.status,
      tasks,
      createdBy: {
        agentId: row.created_by_agent_id,
        name: creatorAgent?.name ?? '(未知)',
        emoji: creatorAgent?.emoji ?? '🤖',
      },
      createdAt: dateToMs(row.created_at),
      // S6 修复：取所有 task.updated_at 的最大值；plan 自身没 updated_at 列时退到 created_at
      updatedAt: taskRows.reduce(
        (acc, tr) => Math.max(acc, dateToMs(tr.updated_at)),
        dateToMs(row.created_at),
      ),
    };
  }

  private taskRowToNodeSnapshot(row: TaskRow, artifacts: TaskArtifactRow[] = []): TaskNodeSnapshot {
    const assignee = this.agentManager.getAgent(row.assignee_agent_id);
    let dependsOn: string[] = [];
    try {
      const parsed = JSON.parse(row.depends_on);
      if (Array.isArray(parsed)) dependsOn = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      logger.warn(`task ${row.id} depends_on JSON 解析失败: ${row.depends_on}`);
    }
    // M13 工作流懒加载：读出 expected_artifact_kinds（可空）
    let expectedArtifactKinds: ArtifactKind[] | undefined;
    if (row.expected_artifact_kinds) {
      try {
        const parsed = JSON.parse(row.expected_artifact_kinds);
        if (Array.isArray(parsed) && parsed.length > 0) {
          expectedArtifactKinds = parsed.filter(
            (x): x is ArtifactKind =>
              typeof x === 'string' &&
              (['text', 'markdown', 'image', 'file', 'doc', 'link'] as const).includes(x as ArtifactKind),
          );
          if (expectedArtifactKinds.length === 0) expectedArtifactKinds = undefined;
        }
      } catch {
        logger.warn(`task ${row.id} expected_artifact_kinds JSON 解析失败: ${row.expected_artifact_kinds}`);
      }
    }
    return {
      id: row.id,
      localId: row.local_id,
      title: row.title,
      description: row.description ?? undefined,
      assignee: {
        agentId: row.assignee_agent_id,
        name: assignee?.name ?? '(未知)',
        emoji: assignee?.emoji ?? '🤖',
      },
      status: row.status,
      dependsOn,
      artifacts: artifacts.map((a) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        uri: a.uri,
        summary: a.summary,
      })),
      staleMarker: row.stale_marker ?? undefined,
      ...(expectedArtifactKinds ? { expectedArtifactKinds } : {}),
    };
  }
}

// ─── 内部工具 ──────────────────────────────────────────────────

/** 拓扑排序检测自环：用 Kahn 算法，剩余节点即环节点 */
function detectCycle(tasks: CreatePlanTaskInput[]): void {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.localId, 0);
    adj.set(t.localId, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      // dep 是 t 的前置：dep → t 边
      adj.get(dep)!.push(t.localId);
      indegree.set(t.localId, (indegree.get(t.localId) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, d] of indegree) if (d === 0) queue.push(id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) ?? []) {
      const nd = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nd);
      if (nd === 0) queue.push(next);
    }
  }
  if (visited !== tasks.length) {
    throw new Error(`task DAG 存在环（无法拓扑排序），visited=${visited} total=${tasks.length}`);
  }
}

/** 渲染 task_ready system event 文本，依赖产出的 artifact 摘要会塞进来 */
function renderTaskReadyEvent(
  plan: TaskPlanSnapshot,
  task: TaskNodeSnapshot,
  taskByLocalId: Map<string, TaskNodeSnapshot>,
): string {
  const lines: string[] = [];
  lines.push(`<system_event kind="task_ready" plan_id="${plan.id}" task_id="${task.localId}">`);
  lines.push(`你的任务 ${task.localId}（${task.title}）已就绪。`);
  lines.push(`plan goal: ${plan.goal}`);
  if (task.description) {
    lines.push(`description: ${task.description}`);
  }

  if (task.dependsOn.length > 0) {
    lines.push(`前置任务已完成：`);
    for (const depId of task.dependsOn) {
      const dep = taskByLocalId.get(depId);
      if (!dep) continue;
      lines.push(`  - ${depId} (${dep.title}) by ${dep.assignee.name}`);
      if (dep.artifacts.length > 0) {
        lines.push(`    产出：`);
        for (const art of dep.artifacts) {
          const icon = artifactKindIcon(art.kind);
          lines.push(`      ${icon} ${art.title} [${art.kind}] uri=${art.uri}`);
          lines.push(`        摘要：${art.summary}`);
        }
      }
    }
    lines.push(`需要查看完整产出，请用 fetch_artifact(id, mode='full')。`);
  }

  lines.push(`完成后请调用 update_task_status(task_id='${getServiceTaskIdHint(task)}', status='done', output_summary='...')。`);
  lines.push(`</system_event>`);
  return lines.join('\n');
}

function artifactKindIcon(kind: string): string {
  switch (kind) {
    case 'doc': return '📄';
    case 'image': return '🖼️';
    case 'file': return '📎';
    case 'markdown': return '📝';
    case 'link': return '🔗';
    default: return '📌';
  }
}

/**
 * 提示 Agent 用 task_id 调 update_task_status
 *
 * 注：snapshot 里 localId 是稳定本地 ID，但 update_task_status 需要 DB 主键 task_id（UUID）。
 * 这里给个占位，运行时由 service.dispatchReadyTasks 在文本里实际填入 row.id。
 *
 * 当前实现传 localId 给 LLM，LLM 需要先 list_tasks 拿到真 task_id。
 * 简化方案：直接在事件文本里展示 localId，LLM 自然会对照 list_tasks 输出。
 */
function getServiceTaskIdHint(task: TaskNodeSnapshot): string {
  return task.localId; // 让 LLM 看到稳定 localId，调用时再查
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateToMs(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : Date.now();
}
