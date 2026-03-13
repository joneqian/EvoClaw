import type { ChannelType } from './channel.js';

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
