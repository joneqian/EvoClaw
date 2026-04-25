/**
 * Team Mode Prompt Fragment —— 系统 prompt 注入的 <team_mode> 段（M13 多 Agent 团队协作）
 *
 * 渲染结构：
 *   <team_mode channel="..." group_key="...">
 *     <team_roster>
 *       <peer agent_id mention_id role>
 *         {emoji} {name} · {capabilityHint?}
 *       </peer>
 *       ...
 *     </team_roster>
 *     <my_open_tasks>
 *       - [status] localId: title (依赖：t1 ✅, t2 ⏳)
 *       ...
 *     </my_open_tasks>
 *     <rules>
 *       - 行为规则（PM-agnostic）
 *     </rules>
 *   </team_mode>
 *
 * 注入时机：当前 session 是群聊且 peer-roster 非空时，由
 * channel-message-handler 通过 promptOverrides append 追加到 system prompt 末尾。
 */

import { createLogger } from '../../infrastructure/logger.js';
import type {
  GroupSessionKey,
  PeerBotInfo,
  TaskPlanSnapshot,
  TaskStatus,
} from '../../channel/team-mode/team-channel.js';

const logger = createLogger('team-mode/prompt-fragment');

/** 当前 Agent 名下未完成任务的精简视图（用于 <my_open_tasks>） */
export interface MyOpenTask {
  /** 任务在 plan 内的稳定 local_id（如 t1 / t2） */
  localId: string;
  title: string;
  status: TaskStatus;
  /** 依赖的前置 local_id 列表 */
  dependsOn: string[];
  /** 各前置任务当前状态（用于渲染 ✅⏳） */
  dependsStatus?: Record<string, TaskStatus>;
}

export interface TeamModePromptInput {
  /** 渠道类型，如 'feishu'（仅展示 / 调试用） */
  channelType: string;
  /** 群会话 key */
  groupSessionKey: GroupSessionKey;
  /** 同事 roster（不含自己） */
  roster: PeerBotInfo[];
  /** 当前 Agent 名下未完成任务（来自 task-plan 服务） */
  myOpenTasks: MyOpenTask[];
  /**
   * 当前群里所有 active plan（M13 修复 — 解决 LLM 重述 WBS 上下文盲点）
   *
   * 任何 agent 被触发时都能看到"群里在跑什么 plan、自己有没有任务、进度多少"，
   * 自然不会重复 createPlan 或者用 markdown 重述 WBS 表格。
   */
  activePlans?: TaskPlanSnapshot[];
  /**
   * 当前 agent 的 ID（用于在 <active_plans> 里标注"我的角色"——是 plan 创建者还是普通 assignee）
   */
  myAgentId?: string;
  /**
   * 当前 Agent 是否为本群协调中心（M13 修改组 3 — 配置驱动）
   *
   * 来自 AgentConfig.isTeamCoordinator。true 时注入 <my_coordination_role> 段，
   * 让 LLM 知道自己是协调中心。
   */
  myIsCoordinator?: boolean;
}

/**
 * 渲染 <team_mode> XML 片段
 *
 * 返回 null 表示无需注入（roster 为空且无任务），上游应跳过 promptOverrides 拼装。
 */
export function renderTeamModePrompt(input: TeamModePromptInput): string | null {
  const activePlans = input.activePlans ?? [];
  if (
    input.roster.length === 0 &&
    input.myOpenTasks.length === 0 &&
    activePlans.length === 0
  ) {
    logger.debug(
      `roster + tasks + active_plans 都为空，跳过 prompt 注入 key=${input.groupSessionKey}`,
    );
    return null;
  }

  const activePlansXml = renderActivePlans(activePlans, input.myAgentId);
  const myCoordRoleXml = renderMyCoordinationRole(input.myIsCoordinator === true);
  const teamCoordXml = renderTeamCoordinator(input.roster);
  const rosterXml = renderRoster(input.roster);
  const tasksXml = renderMyOpenTasks(input.myOpenTasks);
  // M13 修复：rules 按场景条件渲染——通用协作守则始终注入；
  // task_plan 相关守则只在确实存在 active plan 或我有 open task 时才注入，
  // 避免给非 PM 风格的多 Agent 协作场景（写作小组、客服 trio 等）硬塞 PM 假设。
  const rules = renderRules({
    hasActivePlans: activePlans.length > 0,
    hasMyOpenTasks: input.myOpenTasks.length > 0,
  });

  const fragment = [
    `<team_mode channel="${escapeXmlAttr(input.channelType)}" group_key="${escapeXmlAttr(input.groupSessionKey)}">`,
    activePlansXml,
    // M13 修改组 3：协调者上下文（仅当配置驱动启用时）
    myCoordRoleXml,
    teamCoordXml,
    rosterXml,
    tasksXml,
    rules,
    `</team_mode>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  logger.debug(
    `渲染 team_mode prompt key=${input.groupSessionKey} peers=${input.roster.length} ` +
      `my_tasks=${input.myOpenTasks.length} active_plans=${activePlans.length} bytes=${fragment.length}`,
  );

  return fragment;
}

/**
 * 渲染 <active_plans> 段（M13 修复 — 防 LLM 重述 WBS）
 *
 * 列出当前群里所有 active plan + 每个任务的状态 + 当前 agent 在 plan 里的角色。
 * 让任何 agent 被触发时都明确知道"群里已经在跑什么"，自然不会重新 createPlan / 重述 WBS。
 *
 * 设计原则：task_plan 是可选子能力——空时**不渲染**整段，避免给非 PM 风格的多 Agent
 * 协作场景（写作小组、客服 trio、研究组等）打入 "你应该想 task plan" 的隐式框架。
 */
function renderActivePlans(plans: TaskPlanSnapshot[], myAgentId?: string): string {
  if (plans.length === 0) {
    return ''; // 空段不渲染，让 prompt 保持中性（无 task_plan 假设）
  }
  const blocks = plans.map((plan) => {
    const total = plan.tasks.length;
    const done = plan.tasks.filter((t) => t.status === 'done').length;
    const inProgress = plan.tasks.filter((t) => t.status === 'in_progress').length;

    const taskLines = plan.tasks.map((t) => {
      const icon =
        t.status === 'done' ? '✅'
        : t.status === 'in_progress' ? '🚧'
        : t.status === 'blocked' || t.status === 'needs_help' ? '🚨'
        : t.status === 'cancelled' || t.status === 'paused' || t.status === 'stalled' ? '⏸️'
        : '⏳';
      const deps = t.dependsOn.length > 0 ? ` (依赖 ${t.dependsOn.join(',')})` : '';
      const mine = myAgentId && t.assignee.agentId === myAgentId ? ' 👈 你的任务' : '';
      return `      - ${t.localId} ${icon} ${escapeXmlText(t.status)} · ${escapeXmlText(t.assignee.name)}${escapeXmlText(deps)}${mine} "${escapeXmlText(t.title)}"`;
    }).join('\n');

    let myRoleNote = '';
    if (myAgentId) {
      const isOwner = plan.createdBy.agentId === myAgentId;
      const myTasks = plan.tasks.filter((t) => t.assignee.agentId === myAgentId);
      const roleParts: string[] = [];
      if (isOwner) roleParts.push('plan 创建者 · 兜底责任人');
      if (myTasks.length > 0) {
        roleParts.push(`分管 ${myTasks.map((t) => t.localId).join('/')}`);
      }
      if (roleParts.length === 0) roleParts.push('（你不在本计划中——别抢活）');
      myRoleNote = `\n    你的角色：${roleParts.join(' · ')}`;
    }

    return `  <plan id="${escapeXmlAttr(plan.id)}" status="${escapeXmlAttr(plan.status)}" created_by="${escapeXmlAttr(plan.createdBy.name)}">
    目标：${escapeXmlText(plan.goal)}
    进度：${done}/${total} done${inProgress > 0 ? ` · ${inProgress} in_progress` : ''}
    任务：
${taskLines}${myRoleNote}
  </plan>`;
  }).join('\n');

  return `<active_plans>\n${blocks}\n</active_plans>`;
}

/**
 * 渲染 <my_coordination_role>（M13 修改组 3 — 配置驱动）
 *
 * 仅当当前 Agent 自身的 `AgentConfig.isTeamCoordinator === true` 时注入。
 * 让 LLM 知道自己在本群的协调中心角色——理解需求 / 拆解 / 派活 / 跟进 / 汇报。
 *
 * 不开/未配置 → 返回空串，prompt 不暗示任何"协调者"概念，平行协作场景中性。
 */
function renderMyCoordinationRole(myIsCoordinator: boolean): string {
  if (!myIsCoordinator) return '';
  return `<my_coordination_role>
你是本群的协调中心。职责：
- 理解用户需求 / 拆解任务 / 派活给合适的同事
- 跟进进度 / 处理跨角色阻塞 / 向用户汇报
- 信息汇集到你这里，由你统筹分发
- 让具体角色的同事专注做事，自己当信息枢纽
</my_coordination_role>`;
}

/**
 * 渲染 <team_coordinator>（M13 修改组 3 — 配置驱动）
 *
 * 仅当 roster 里有同事开了 isCoordinator 时注入。
 * 引导其他 Agent 跨角色对接通过协调者，不私下找别人。
 * 多个协调者全部列出，由 LLM 自由判断 @ 谁。
 *
 * roster 不含自己，所以这里不会因"我自己是协调者"而把自己列进去。
 */
function renderTeamCoordinator(roster: PeerBotInfo[]): string {
  const coordinators = roster.filter((p) => p.isCoordinator === true);
  if (coordinators.length === 0) return '';
  const names = coordinators
    .map((c) => `${escapeXmlText(c.name)}（agent_id=${escapeXmlAttr(c.agentId)}）`)
    .join('、');
  return `<team_coordinator>
本群协调中心：${names}
跨角色对接（@ 不在你直接对话链里的同事）请通过 mention_peer @ 协调中心，由它统筹分配，不要绕过协调者直接找其他角色。
</team_coordinator>`;
}

function renderRoster(roster: PeerBotInfo[]): string {
  if (roster.length === 0) {
    return `<team_roster>\n  <!-- 群里目前没有其他 EvoClaw 同事 -->\n</team_roster>`;
  }
  // M13 修复：不再注入 emoji 字符 — 防 LLM 复读 "emoji+名字" 拼成裸文本 @
  // （如 "@📈 产品经理"），应改用 mention_peer 工具走真·原生 @
  const peers = roster
    .map((p) => {
      const capability = p.capabilityHint ? ` · ${p.capabilityHint}` : '';
      return `  <peer agent_id="${escapeXmlAttr(p.agentId)}" mention_id="${escapeXmlAttr(p.mentionId)}" role="${escapeXmlAttr(p.role)}">
    ${escapeXmlText(p.name)}${escapeXmlText(capability)}
  </peer>`;
    })
    .join('\n');
  return `<team_roster>\n${peers}\n</team_roster>`;
}

function renderMyOpenTasks(tasks: MyOpenTask[]): string {
  if (tasks.length === 0) {
    return ''; // 空段不渲染，避免在非 task_plan 场景下硬注入"任务"概念
  }
  const items = tasks
    .map((t) => {
      const depsStr = renderDeps(t.dependsOn, t.dependsStatus);
      return `- [${t.status}] ${t.localId}: ${escapeXmlText(t.title)}${depsStr}`;
    })
    .join('\n');
  return `<my_open_tasks>\n${items}\n</my_open_tasks>`;
}

function renderDeps(dependsOn: string[], statuses?: Record<string, TaskStatus>): string {
  if (dependsOn.length === 0) return '';
  const parts = dependsOn.map((id) => {
    const st = statuses?.[id];
    const icon = st === 'done' ? '✅' : st === 'in_progress' ? '🚧' : '⏳';
    return `${id} ${icon}`;
  });
  return `（依赖：${parts.join('，')}）`;
}

/**
 * 渲染 <rules> 段（M13 修复 — 解除 PM 工作流绑架）
 *
 * 通用协作守则始终注入；task_plan 相关守则**只在实际有 plan / open task 时**才注入，
 * 让 prompt 在不同协作场景下保持中性（不预设 PM/拆 WBS 框架）。
 *
 * 注：mention_peer 是跨场景通用工具（任意 multi-agent 协作都可能用到 @），所以归通用。
 *     update_task_status / request_clarification 是 task_plan 专用工具，归 task_plan 段。
 */
function renderRules(opts: { hasActivePlans: boolean; hasMyOpenTasks: boolean }): string {
  // 通用协作守则：与 task_plan 无关，任何 multi-agent 群里都适用
  // 注：协议层 reply-to 兜底（channel-message-handler.applyAtFallbackPrefix）
  // 已物理保障 peer @ 链路不断，不再 prompt 教 LLM "必须 @ 回提问者"——
  // 那是应用层礼仪假设，违背系统通用性
  const universal: string[] = [
    '- 只处理你被 @ 的任务。同事间对话仅作上下文，别抢活',
    '- @ 同事请用 mention_peer 工具（跨渠道通用），裸文本 @ 不会触发推送通知',
    '- 不确定该让谁处理时，看 team_roster 里同事的 role 和 capability',
    '- 群里同事 Agent @ 你的消息不是新任务，是协作回应；不要把它当成用户新请求的开端',
    '- 收到同事 Agent 的 @（peer mention）时，仅在你能加价值时回复（决策、补充、澄清、推进）；纯进度同步 / 知道即可的场景请用 NO_REPLY，避免群里噪音',
  ];

  // task_plan 子能力相关守则：只在该上下文存在时注入
  const taskPlanRules: string[] = [];
  if (opts.hasActivePlans) {
    taskPlanRules.push(
      '- 看到 <active_plans> 已存在覆盖当前用户请求的 plan 时，**禁止再 createPlan**，应对用户同步当前 plan 的进展（用 list_tasks 查最新状态）',
    );
  }
  if (opts.hasMyOpenTasks) {
    taskPlanRules.push(
      '- 完成 / 阻塞 / 求助 必须调 update_task_status 工具，不是口头说"干完了"',
      '- 任务遇到信息缺口时调 request_clarification（自动找派活的人），不要瞎猜',
      '- 任务失败 / 异常时主动 update_task_status(\'needs_help\')，会自动升级给 task.created_by',
      '- **工具调用被熔断 / 系统报错 / 反复失败时**，立刻调 update_task_status(\'blocked\', note=\'<原因>\') 上报阻塞，让责任链兜底处理 —— 不要原地反复重试同一调用、不要僵在那里空跑等待解封',
    );
  }

  const all = [...universal, ...taskPlanRules];
  return `<rules>\n${all.join('\n')}\n</rules>`;
}

// ─── 简易 XML 转义（足够 LLM prompt 用）───
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
