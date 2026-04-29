import type { ChannelType } from './channel.js';
import type { PermissionMode } from './permission.js';

/** Thinking 级别（渐进降级: high → medium → low → off） */
export type ThinkLevel = 'off' | 'low' | 'medium' | 'high';

/** ThinkLevel 降级顺序 */
export const THINK_LEVEL_ORDER: readonly ThinkLevel[] = ['high', 'medium', 'low', 'off'] as const;

/** 降一级 ThinkLevel，已经 off 则返回 off */
export function degradeThinkLevel(level: ThinkLevel): ThinkLevel {
  const idx = THINK_LEVEL_ORDER.indexOf(level);
  if (idx < 0 || idx >= THINK_LEVEL_ORDER.length - 1) return 'off';
  return THINK_LEVEL_ORDER[idx + 1]!;
}

/** 检测消息是否包含 ultrathink 关键词（触发深度思考） */
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text);
}

/** Agent 状态枚举 */
export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';

/** Agent 工作区文件类型 */
export type AgentFile = 'SOUL.md' | 'IDENTITY.md' | 'AGENTS.md' | 'TOOLS.md' | 'HEARTBEAT.md' | 'USER.md' | 'MEMORY.md' | 'BOOTSTRAP.md';

/**
 * 团队工作流模板的产物类型（与 packages/core 的 ArtifactKind 一致；shared 层独立列出避免循环依赖）
 *
 * 'text'：纯文本短产出
 * 'markdown'：长文档（PRD / 架构稿）
 * 'image'：视觉稿 / 截图
 * 'file'：通用文件（设计稿、压缩包）
 * 'doc'：文档系统外链（飞书 doc / Notion / Google Docs）
 * 'link'：外部链接（部署地址 / 仓库 URL）
 */
export type ArtifactKind = 'text' | 'markdown' | 'image' | 'file' | 'doc' | 'link';

/**
 * 团队工作流模板的一个阶段（M13 — Roster 驱动懒加载）
 *
 * phases 顺序就是 dependsOn 顺序：阶段 N 必依赖阶段 N-1 完成。
 */
export interface TeamWorkflowPhase {
  /** 阶段名（中文短语，如 "需求" / "视觉设计" / "架构设计" / "实现"） */
  name: string;
  /** 期望角色关键词（匹配 peer.role 用，模糊匹配；如 ['产品经理','PM','product']） */
  roleHints: string[];
  /** 该阶段任务的预期产物类型（用于派活时的 expectedArtifactKinds） */
  expectedArtifactKinds: ArtifactKind[];
  /** 一句话职责说明（自然语言，直接显示给协调者 LLM 看） */
  description: string;
}

/**
 * 团队工作流模板（M13 — Roster 驱动懒加载）
 *
 * 由协调者 Agent 第一次被叫出来时跟用户对话敲定，调 propose_team_workflow 工具落盘到
 * AgentConfig.teamWorkflow。后续协调者拆 plan 时按 phases 顺序派活。
 */
export interface TeamWorkflowTemplate {
  /** 自然语言：什么样的需求适用本工作流（给未来的协调者 LLM 看） */
  whenToUse: string;
  /** 阶段顺序链（至少 1 项） */
  phases: TeamWorkflowPhase[];
  /** 模板敲定时间 ISO string */
  createdAt: string;
  /** 用户在群里确认时的真人 user id（可选，作审计） */
  approvedBy?: string;
}

/** Agent 配置 */
export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  status: AgentStatus;
  /** 使用的模型 ID */
  modelId?: string;
  /** 使用的 Provider */
  provider?: string;
  /** 系统提示模板 */
  systemPromptTemplate?: string;
  /** 工具 Profile — 按场景预配置工具集 */
  toolProfile?: 'minimal' | 'coding' | 'messaging' | 'full';
  /** 权限模式覆盖（未设置时使用全局默认） */
  permissionMode?: PermissionMode;
  /** 绑定的 MCP 服务器名称列表 — 为空/undefined 表示使用全部可用服务器 */
  mcpServers?: string[];
  /** 绑定关系 */
  bindings?: Binding[];
  /**
   * 角色（M13 多 Agent 团队协作 - 信息性字段）
   *
   * 内置：'pm' | 'backend' | 'product' | 'design' | 'general'，也支持自定义文本
   * 仅作两种用途：
   *   1. 注入 Agent 自我介绍 prompt（"你的角色是 ..."）
   *   2. 填充 peer roster role 字段供同事识别
   * 不做 tool gating（去 PM 中心化）
   */
  role?: string;
  /**
   * 团队协调者标志（M13 多 Agent 协作 — 配置驱动）
   *
   * 用户在 Agent 设置界面勾选"作为本群协调中心"时为 true：
   *   - 该 Agent 在它所属的多 Agent 群里被视为协调中心
   *   - 自己的 system prompt 自动注入 <my_coordination_role> 段（让 LLM 知道自己是协调者）
   *   - 同群其他 Agent 的 prompt 注入 <team_coordinator> 段（引导跨角色对接通过协调者）
   *
   * 不勾或群里无人勾 → 平行协作模式（不引入协调者概念，系统层保持中性）。
   * 适用场景：PM、组长、客服派单员、辩论主持人等；不适用扁平协作团队。
   */
  isTeamCoordinator?: boolean;
  /**
   * 团队工作流模板（M13 — Roster 驱动懒加载）
   *
   * 仅协调者类 Agent 有意义。第一次被叫出来时为 undefined → prompt 注入
   * `<workflow_bootstrap_required>`，引导协调者看 roster + 跟用户对话敲定后
   * 调 `propose_team_workflow` 工具落盘。落盘后下次响应渲染 `<workflow_template>`，
   * 协调者按 phases 顺序拆 plan、派活、声明 expectedArtifactKinds。
   *
   * 非协调者：忽略此字段。
   */
  teamWorkflow?: TeamWorkflowTemplate;
  /** 创建时间 ISO string */
  createdAt: string;
  /** 更新时间 ISO string */
  updatedAt: string;
}

/** Agent 绑定 — Channel 路由用 */
export interface Binding {
  channel: ChannelType;
  chatType: 'private' | 'group';
  accountId?: string;
  peerId?: string;
}
