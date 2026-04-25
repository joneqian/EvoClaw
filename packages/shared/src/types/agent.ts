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
