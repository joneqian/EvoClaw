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
}

/**
 * 渲染 <team_mode> XML 片段
 *
 * 返回 null 表示无需注入（roster 为空且无任务），上游应跳过 promptOverrides 拼装。
 */
export function renderTeamModePrompt(input: TeamModePromptInput): string | null {
  if (input.roster.length === 0 && input.myOpenTasks.length === 0) {
    logger.debug(
      `roster + tasks 都为空，跳过 prompt 注入 key=${input.groupSessionKey}`,
    );
    return null;
  }

  const rosterXml = renderRoster(input.roster);
  const tasksXml = renderMyOpenTasks(input.myOpenTasks);
  const rules = renderRules();

  const fragment = [
    `<team_mode channel="${escapeXmlAttr(input.channelType)}" group_key="${escapeXmlAttr(input.groupSessionKey)}">`,
    rosterXml,
    tasksXml,
    rules,
    `</team_mode>`,
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  logger.debug(
    `渲染 team_mode prompt key=${input.groupSessionKey} peers=${input.roster.length} my_tasks=${input.myOpenTasks.length} bytes=${fragment.length}`,
  );

  return fragment;
}

function renderRoster(roster: PeerBotInfo[]): string {
  if (roster.length === 0) {
    return `<team_roster>\n  <!-- 群里目前没有其他 EvoClaw 同事 -->\n</team_roster>`;
  }
  const peers = roster
    .map((p) => {
      const capability = p.capabilityHint ? ` · ${p.capabilityHint}` : '';
      const emoji = p.emoji || '🤖';
      return `  <peer agent_id="${escapeXmlAttr(p.agentId)}" mention_id="${escapeXmlAttr(p.mentionId)}" role="${escapeXmlAttr(p.role)}">
    ${emoji} ${escapeXmlText(p.name)}${escapeXmlText(capability)}
  </peer>`;
    })
    .join('\n');
  return `<team_roster>\n${peers}\n</team_roster>`;
}

function renderMyOpenTasks(tasks: MyOpenTask[]): string {
  if (tasks.length === 0) {
    return `<my_open_tasks>\n  <!-- 你目前没有进行中的任务 -->\n</my_open_tasks>`;
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

function renderRules(): string {
  return `<rules>
- 只处理你被 @ 的任务。同事间对话仅作上下文，别抢活
- @ 同事请用 mention_peer 工具（跨渠道通用），裸文本 @ 不会触发推送通知
- 完成 / 阻塞 / 求助 必须调 update_task_status 工具，不是口头说"干完了"
- 缺信息时调 request_clarification（自动找派活的人），不要瞎猜
- 不确定该派给谁时，看 team_roster 里同事的 role 和 capability
- 任务失败 / 异常时主动 update_task_status('needs_help')，会自动升级给 task.created_by
</rules>`;
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
