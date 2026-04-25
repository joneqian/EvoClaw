/**
 * TeamChannelAdapter — Layer 3 跨渠道适配器接口（M13 多 Agent 团队协作核心）
 *
 * 设计原则：
 * - Layer 2（peer-roster / loop-guard / task-plan / artifacts）完全 channel-agnostic
 * - 所有渠道差异（飞书 / iLink / Slack / 企微 / Discord / Teams …）封装在本接口实现里
 * - 一个 channel 一个 adapter，注册到 TeamChannelRegistry，按 GroupSessionKey 前缀分发
 *
 * 接入新渠道见 docs/architecture/team-mode-channel-guide.md
 */

/**
 * 群会话标识（channel-agnostic）
 *
 * 形如：
 *   "feishu:chat:oc_xxx"          飞书群
 *   "ilink:room:wr_xxx"           iLink 微信群
 *   "wecom:groupchat:xxxx"        企微群
 *   "slack:channel:Cxxxxx"        Slack 频道
 *   "discord:guild:1234:channel:5678"  Discord
 *
 * 前缀 `<channelType>:` 用于注册表分发，剩余部分由 adapter 自行约定。
 */
export type GroupSessionKey = string;

/**
 * 渠道原生 @ 标识
 *
 * 飞书：open_id
 * iLink 微信：wxid
 * 企微：userid
 * Slack：U_xxxxxx
 * Discord：user id (snowflake)
 */
export type PeerMentionId = string;

/**
 * Adapter 层返回的最小同事身份（只关心渠道层信息）
 *
 * 设计分层：adapter 只知道"群里有这些 bot 对应这些 EvoClaw Agent"；
 * 不需要也不应该知道 Agent 的 name/emoji/role 等 EvoClaw 业务字段。
 */
export interface PeerBotIdentity {
  /** EvoClaw Agent ID（adapter 通过 bindings 表反查得到） */
  agentId: string;
  /** 渠道原生 @ 标识 */
  mentionId: PeerMentionId;
}

/**
 * 同群同事 Agent 的完整元信息（peer-roster-service 在 PeerBotIdentity 基础上补齐）
 *
 * 用途：prompt 注入 <team_roster>、mention_peer 工具、看板渲染等。
 */
export interface PeerBotInfo extends PeerBotIdentity {
  /** 来自 IDENTITY.md 的 name */
  name: string;
  /** Agent emoji（默认 🤖） */
  emoji: string;
  /** 角色一行摘要（来自 agents.role + IDENTITY.md/SOUL.md） */
  role: string;
  /** 能力一行摘要（可选，从 SOUL.md / capability_graph 抽） */
  capabilityHint?: string;
  /**
   * 是否为本群协调中心（M13 修改组 3 — 配置驱动）
   *
   * 来自 AgentConfig.isTeamCoordinator。prompt-fragment 据此渲染 <team_coordinator> 段，
   * 引导其他 Agent 跨角色对接通过协调者。
   */
  isCoordinator?: boolean;
}

/**
 * 入站消息分类四分支
 *
 * 各 adapter 必须把每条入站消息分到这四类之一：
 *   - self      自己 bot 的回声 → drop（防回环）
 *   - peer      同群另一个 EvoClaw bot → 收下，走 loop-guard
 *   - stranger  非 EvoClaw 的 bot 或外部应用 → drop
 *   - user      真人用户 → 走原流程
 */
export type MessageClassification =
  | { kind: 'self'; reason: string }
  | { kind: 'peer'; senderAgentId: string }
  | { kind: 'stranger'; reason?: string }
  | { kind: 'user'; userId: string };

/**
 * 当前 bot 自我上下文（识别 self/peer 用）
 *
 * 各 channel 实际字段不同，allow extension。
 */
export interface OwnBotContext {
  /** 当前 EvoClaw Agent ID（必填） */
  agentId: string;
  /** 渠道账号标识：飞书 appId / 企微 corpId / Slack workspace 等 */
  accountId?: string;
  /** 当前 bot 的渠道原生标识：open_id / wxid / bot user id */
  selfMentionId?: PeerMentionId;
  /** 渠道特定的扩展字段 */
  [key: string]: unknown;
}

/**
 * Adapter 输出的渠道无关消息体
 *
 * 实际投递时 adapter 会把 payload 转换成渠道原生 API 调用。本接口只负责"产出 + 携带元数据"。
 */
export interface ChannelOutboundMessage {
  /** 渠道类型（用于路由 / 日志） */
  channelType: string;
  /** 退化文本（用于日志、测试断言、不支持富文本的 fallback） */
  fallbackText: string;
  /** 渠道原生结构化 payload（飞书 post JSON / Slack Block Kit / Discord Embed 等） */
  payload: unknown;
  /** 携带的业务元数据（task / plan / loop-guard 链深度） */
  metadata?: TeamMessageMetadata;
}

/**
 * Team Mode 消息元数据
 *
 * 在 peer-to-peer @ 时塞进消息扩展字段（飞书 message_extra / Slack metadata 等），
 * 入站时由 adapter 抽出来供 loop-guard / task service 使用。
 */
export interface TeamMessageMetadata {
  taskId?: string;
  planId?: string;
  /** loop-guard 链深度，下一跳 +1，超过 5 拦截 */
  chainDepth?: number;
}

/**
 * 任务节点快照（看板渲染用，channel-agnostic）
 */
export interface TaskNodeSnapshot {
  /** DB 主键 UUID — assignee 调 update_task_status 用这个 id（不是 localId） */
  id: string;
  localId: string;
  title: string;
  description?: string;
  assignee: { agentId: string; name: string; emoji: string };
  status: TaskStatus;
  dependsOn: string[]; // local_id 数组
  artifacts: ArtifactSummary[];
  staleMarker?: 'yellow_15min' | 'red_30min';
}

/**
 * Plan 完整快照
 */
export interface TaskPlanSnapshot {
  id: string;
  groupSessionKey: GroupSessionKey;
  channelType: string;
  goal: string;
  status: PlanStatus;
  tasks: TaskNodeSnapshot[];
  createdBy: { agentId: string; name: string; emoji: string };
  createdAt: number;
  updatedAt: number;
}

/**
 * Artifact 摘要（看板内嵌展示）
 */
export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  title: string;
  uri: string;
  summary: string;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'cancelled'
  | 'blocked'
  | 'needs_help'
  | 'blocked_on_clarification'
  | 'paused'
  | 'stalled';

export type PlanStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export type ArtifactKind = 'text' | 'markdown' | 'image' | 'file' | 'doc' | 'link';

/**
 * 渠道适配器主接口
 *
 * 实现类放在 packages/core/src/channel/adapters/<channel>/team-channel.ts
 * 注册到 TeamChannelRegistry，按 GroupSessionKey 前缀分发。
 */
export interface TeamChannelAdapter {
  /** 渠道类型常量（'feishu' / 'ilink' / 'wecom' / 'slack' …） */
  readonly channelType: string;

  /**
   * 入站消息分类：判定来自自己、同事 bot、陌生 bot 还是真人
   *
   * 实现要点：
   * - self 必须用 ID 比对（不是用户名），漏掉会无限回声
   * - peer 必须 join 本地 bindings 表才能认出是 EvoClaw 同事
   * - stranger 兜底：未识别一律 drop，避免外部 bot 注入指令
   */
  classifyInboundMessage(
    event: unknown,
    ownContext: OwnBotContext,
  ): Promise<MessageClassification>;

  /**
   * 列出群里所有 EvoClaw 绑定的 bot 身份（不含自己）
   *
   * 仅返回 PeerBotIdentity（agentId + mentionId），完整元信息由 peer-roster-service
   * 通过 AgentManager 补齐。
   *
   * 首选：调渠道 chat.members API + 反查 bindings 表
   * 降级：被动缓存模式（无群成员 API 的渠道，从入站消息累积）
   */
  listPeerBots(
    groupSessionKey: GroupSessionKey,
    selfAgentId: string,
  ): Promise<PeerBotIdentity[]>;

  /**
   * 构造带真·@ 的消息体（渠道原生格式）
   *
   * 必须用渠道原生 mention 语法（飞书 <at user_id>、Slack <@U>、Discord <@id>）
   * 才能触发推送通知；裸文本 @ 不算 mention。
   */
  buildMention(
    groupSessionKey: GroupSessionKey,
    peer: PeerBotInfo,
    text: string,
    metadata?: TeamMessageMetadata,
  ): Promise<ChannelOutboundMessage>;

  /**
   * 渲染项目看板（飞书 → CardKit；Slack → Block Kit；微信 → Markdown）
   */
  renderTaskBoard(plan: TaskPlanSnapshot): ChannelOutboundMessage;

  /**
   * 更新已发出的看板消息
   *
   * 支持原地更新的渠道（飞书 / Slack / Discord）→ 调原 update API
   * 不支持的渠道 → 发新一条，旧的标"已过期"
   */
  updateTaskBoard(
    groupSessionKey: GroupSessionKey,
    existingCardId: string | null,
    plan: TaskPlanSnapshot,
  ): Promise<{ cardId: string }>;

  /**
   * 群成员变更事件订阅（可选）
   *
   * 用于即时失效 peer-roster 缓存。
   * 没有事件流的渠道靠 5 min TTL 兜底。
   */
  onGroupMembershipChanged?(handler: (key: GroupSessionKey) => void): void;
}
