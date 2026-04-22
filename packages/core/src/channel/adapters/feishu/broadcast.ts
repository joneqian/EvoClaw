/**
 * 飞书 Channel 广播（Broadcast）模式
 *
 * 解决"一群多机器人同时响应一条消息"的场景（AI 圆桌 / 会议室 / 联合值班）：
 * - 未开启时：一条消息由 BindingRouter 路由到单个 Agent，行为不变
 * - 开启后：命中配置的群 / 联系人，一条消息 fanout 到配置的 agent 列表，
 *   每个 Agent 各自走完整处理管线并回复
 *
 * 与 Phase M（GroupHistoryBuffer）的分工：
 * - Phase M 让"没被 @ 的 Agent"在被 @ 时能看到前情提要（解决读一侧）
 * - Phase B 让"一条消息触发多个 Agent 同时响应"（解决写一侧）
 *
 * OpenClaw 原版使用 `buildBroadcastSessionKey` 把 session key 前缀从 origAgent
 * 换成 targetAgent，EvoClaw 由 server.ts 路由层直接为每个 target 生成独立
 * session key，不需要字符串替换，语义更干净。
 */

import type { FeishuReceiveEvent } from './inbound.js';

/** 激活策略 */
export type BroadcastTriggerMode = 'mention-first' | 'any-mention' | 'always';

export const BROADCAST_TRIGGER_MODES: readonly BroadcastTriggerMode[] = [
  'mention-first',
  'any-mention',
  'always',
] as const;

export const BROADCAST_TRIGGER_LABELS: Record<BroadcastTriggerMode, string> = {
  'mention-first': '只激活被 @ 到的机器人（默认）',
  'any-mention': '任一机器人被 @ 时激活全体',
  always: '任何消息都激活全体（不需要 @）',
};

/** 广播配置 */
export interface BroadcastConfig {
  /** 总开关，默认 false */
  enabled: boolean;
  /**
   * peerId（通常是 chatId，未经 session scope 重写）→ agentId 列表
   *
   * - 同一 chatId 下列表里的 agent 都会被激活
   * - 一个 chatId 不在配置中时，退化为 BindingRouter 单路路由
   */
  peerAgents: Record<string, string[]>;
  /** 激活策略，默认 'any-mention' */
  triggerMode: BroadcastTriggerMode;
}

export const DEFAULT_BROADCAST_CONFIG: BroadcastConfig = {
  enabled: false,
  peerAgents: {},
  triggerMode: 'any-mention',
};

/**
 * 给定一条群聊消息，判断是否命中 broadcast 并返回 fanout 目标列表
 *
 * 返回规则：
 * - config.enabled=false → null（不广播）
 * - peerId 不在 peerAgents → null（不广播，走 BindingRouter）
 * - triggerMode='mention-first' 且消息未 @ 列表中任何 agent → null
 * - triggerMode='any-mention' 且既未 @_all 又未 @ 任何列表 agent → null
 * - triggerMode='always' → 始终返回配置的全体 agent
 *
 * 命中时返回全体 agentId（去重、保持配置顺序），空列表视为未命中返回 null。
 */
export function resolveBroadcastTargets(params: {
  config: BroadcastConfig;
  peerId: string;
  /** 该群内所有机器人的 open_id → agentId 映射（用于把 @open_id 翻译为 agentId） */
  botIdToAgentId?: Record<string, string>;
  /** 消息里的 mentions（仅群消息有意义） */
  mentions: FeishuReceiveEvent['message']['mentions'];
  /** 消息是否 @了 @_all */
  mentionedAll?: boolean;
}): string[] | null {
  const { config, peerId, mentions, mentionedAll = false, botIdToAgentId = {} } =
    params;

  if (!config.enabled) return null;
  if (!peerId) return null;

  const configured = config.peerAgents[peerId];
  if (!configured || configured.length === 0) return null;

  // 去重保序
  const dedupedConfigured = dedupePreserveOrder(configured);

  if (config.triggerMode === 'always') {
    return dedupedConfigured;
  }

  // 抽取消息中被 @ 到的 agentId 列表
  const mentionedAgentIds = extractMentionedAgentIds(
    mentions,
    botIdToAgentId,
    dedupedConfigured,
  );

  if (config.triggerMode === 'mention-first') {
    if (mentionedAgentIds.length === 0) return null;
    // 只激活被 @ 的（保持配置顺序）
    return dedupedConfigured.filter((id) => mentionedAgentIds.includes(id));
  }

  // any-mention：@_all 或 @任一列表 agent → 激活全体
  if (mentionedAll || mentionedAgentIds.length > 0) {
    return dedupedConfigured;
  }
  return null;
}

/**
 * 从 mentions 数组中抽出"被 @ 且在配置列表中"的 agentId
 */
export function extractMentionedAgentIds(
  mentions: FeishuReceiveEvent['message']['mentions'],
  botIdToAgentId: Record<string, string>,
  configuredAgents: readonly string[],
): string[] {
  if (!mentions || mentions.length === 0) return [];
  const configuredSet = new Set(configuredAgents);
  const out: string[] = [];
  for (const m of mentions) {
    const openId = m.id.open_id ?? m.id.user_id ?? m.id.union_id;
    if (!openId) continue;
    const agentId = botIdToAgentId[openId];
    if (!agentId) continue;
    if (!configuredSet.has(agentId)) continue;
    if (out.includes(agentId)) continue;
    out.push(agentId);
  }
  return out;
}

/**
 * 构造广播 dedupe key —— 同一原始 messageId 在所有目标 agent 共用一个根 key，
 * 但每个 agent 处理自己的实际工作时应使用 `${rootKey}:${agentId}` 便于追踪。
 *
 * ChannelDedupeStore 调用侧只需保证同一原消息多次进入 inbound 时只处理一次即可，
 * 这里返回的是"原消息维度"的根 key。
 */
export function buildBroadcastDedupeKey(params: {
  channel: 'feishu';
  peerId: string;
  messageId: string;
}): string {
  return `broadcast:${params.channel}:${params.peerId}:${params.messageId}`;
}

/** 数组去重保序 */
function dedupePreserveOrder<T>(items: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
