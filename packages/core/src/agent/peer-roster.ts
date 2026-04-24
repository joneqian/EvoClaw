/**
 * 群聊 peer roster 构造器 —— 让 Agent 知道自己身处多 bot 群聊,还有哪些同事
 *
 * 背景:
 * 多 agent 绑到同一个群聊时,每个 Agent 的 system prompt 默认对 "在群里协作"
 * 一无所知 —— 它以为是 1:1 咨询,被用户问到"谁负责 UI"这种团队类问题时会
 * 让用户补充 RACI 矩阵 / 项目背景。真实情况是"群里还有 UX 设计师 agent,
 * 那个问题应该让他答"。
 *
 * 这份 roster 用 bindingRouter 反查出和当前 agent 绑定到同一 channel 的
 * 其他 active agent,按 `{emoji} {name}` 列出,追加一段引导文案:不归你的
 * 问题就传球给同事,不要硬接。
 *
 * 范围约定(V1):
 * - 粒度 = "同 channel 所有 active agent",不精确到 chatId(V2 补)
 * - 仅列 name + emoji,不读 SOUL/AGENTS.md(token 开销 + 隐私考虑)
 * - 覆盖所有群聊 channel(feishu / wechat / wecom / dingtalk / qq / ...)
 * - 单 agent 群 / 非 active peer 过滤后为空 → 返回 null 不注入
 */

import type { BindingRouter } from '../routing/binding-router.js';
import type { AgentManager } from './agent-manager.js';

/**
 * Channel → 人类可读的平台名(中文优先,海外命名保留英文)
 *
 * 未知 channel 兜底用原 channel 字符串,不报错。
 */
const CHANNEL_LABELS: Record<string, string> = {
  feishu: '飞书',
  lark: 'Lark',
  wechat: '微信',
  weixin: '微信',
  wecom: '企业微信',
  dingtalk: '钉钉',
  qq: 'QQ',
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
};

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel.toLowerCase()] ?? channel;
}

/**
 * 构造群聊 peer roster 文本,追加到 system prompt(走 promptOverrides 'append' 路径)
 *
 * @param agentId 当前 agent(roster 自动排除)
 * @param channel 当前消息所属 channel(过滤 peer)
 * @param bindingRouter 绑定路由,用 listBindings() 枚举 peer
 * @param agentManager 用于取 peer 的 name/emoji/status
 * @returns 非空 roster 文本 或 null(无同事时跳过注入)
 */
export function buildGroupPeerRoster(
  agentId: string,
  channel: string,
  bindingRouter: BindingRouter | undefined,
  agentManager: AgentManager,
): string | null {
  if (!bindingRouter) return null;

  const bindings = bindingRouter.listBindings();
  const peerAgentIds = new Set<string>();
  for (const b of bindings) {
    if (b.channel !== channel) continue;
    if (b.agentId === agentId) continue;
    peerAgentIds.add(b.agentId);
  }
  if (peerAgentIds.size === 0) return null;

  const peers: Array<{ emoji: string; name: string }> = [];
  for (const peerId of peerAgentIds) {
    const peer = agentManager.getAgent(peerId);
    if (!peer) continue;
    if (peer.status !== 'active') continue; // 草稿/归档不列入,避免内部 agent 暴露给用户
    peers.push({
      emoji: peer.emoji || '🤖',
      name: peer.name,
    });
  }
  if (peers.length === 0) return null;

  const platformLabel = channelLabel(channel);
  const roster = peers.map((p) => `- ${p.emoji} ${p.name}`).join('\n');

  // 这段文案会作为 promptOverrides 'append' 追加到 system prompt 末尾,
  // 包一层 <group_peers> 标签帮助模型识别这是结构化上下文而非用户消息。
  return `<group_peers>
You are one of several AI agents active in this ${platformLabel} group chat.
Your teammates (other agents in this group):
${roster}

When a user's question falls outside YOUR scope but clearly fits a teammate's:
- Don't try to answer it yourself.
- Don't ask the user for project details to "cover" missing scope.
- Briefly say "这个不归我 / Not my area" and suggest the relevant teammate by name.

When multiple teammates could answer, keep your reply short and add value on top
of what peers said (don't repeat their content verbatim). If a peer already fully
answered and you have nothing to add, acknowledge briefly (e.g. "同上 / +1") rather
than staying silent — NO_REPLY is NOT allowed when you are @-mentioned (direct or
via @_all). Being mentioned means the user expects a response from each addressed
agent, even a short one.
</group_peers>`;
}
