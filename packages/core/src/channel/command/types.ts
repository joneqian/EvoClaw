/**
 * 渠道命令系统类型定义
 */

import type { ChannelType } from '@evoclaw/shared';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import type { AgentManager } from '../../agent/agent-manager.js';
import type { ChannelManager } from '../channel-manager.js';
import type { ConfigManager } from '../../infrastructure/config-manager.js';
import type { ChannelStateRepo } from '../channel-state-repo.js';
import type { SkillDiscoverer } from '../../skill/skill-discoverer.js';

/** 命令执行上下文 */
export interface CommandContext {
  /** Agent ID（通过 BindingRouter 解析） */
  readonly agentId: string;
  /** 渠道类型 */
  readonly channel: ChannelType;
  /** 对话对象 ID（用户或群组） */
  readonly peerId: string;
  /** 发送者 ID */
  readonly senderId: string;
  /** 账号 ID */
  readonly accountId: string;

  // 服务依赖
  readonly store: SqliteStore;
  readonly agentManager: AgentManager;
  readonly channelManager: ChannelManager;
  readonly configManager?: ConfigManager;
  readonly stateRepo?: ChannelStateRepo;
  readonly skillDiscoverer?: SkillDiscoverer;
}

/** 渠道命令定义 */
export interface ChannelCommand {
  /** 命令名（不含 /） */
  readonly name: string;
  /** 别名列表 */
  readonly aliases?: readonly string[];
  /** 描述（用于 /help 展示） */
  readonly description: string;
  /** 执行命令 */
  execute(args: string, ctx: CommandContext): Promise<CommandResult>;
}

/** 命令执行结果 */
export interface CommandResult {
  /** 是否已处理（true 表示不继续走 AI 管线） */
  handled: boolean;
  /** 直接回复的文本 */
  response?: string;
  /** true = 技能 fallback，注入对话继续 AI 处理 */
  injectToConversation?: boolean;
  /** fallback 时的技能名 */
  skillName?: string;
  /** fallback 时的技能参数 */
  skillArgs?: string;
}
