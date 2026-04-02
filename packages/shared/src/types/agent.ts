import type { ChannelType } from './channel.js';

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
  /** 绑定关系 */
  bindings?: Binding[];
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
