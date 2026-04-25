/**
 * GroupSessionKey 构造与还原（M13 PR4-fix-B3）
 *
 * 不同渠道的 peerId 在群聊场景下可能带"会话隔离 scope"后缀：
 *   - 飞书 group_sender / group_topic / group_topic_sender → "oc_xxx:sender:ou_yyy" 等
 *   - 微信 / 企微 / Slack 默认无后缀
 *
 * team-mode 的 GroupSessionKey 必须用 **裸 chatId**（团队是按物理群划分，不按 sender 分），
 * 否则同群里不同 sender 创建的 plan 会互相不可见、peer-bot-registry 也查不到。
 *
 * 本模块提供：
 *   extractRawChatId(channel, peerId)  → 裸 chatId
 *   buildGroupSessionKey(channel, peerId) → "feishu:chat:oc_xxx" 等
 *
 * 不依赖 channel 层（agent → channel 是禁止的层级），格式硬编码（与
 * channel/adapters/feishu/session-key.ts 的 parseFeishuGroupPeerId 对齐）。
 */

import type { GroupSessionKey } from '../../channel/team-mode/team-channel.js';

/**
 * 从 peerId 中抽出"物理群 chatId"，剥离任何 scope 后缀
 *
 * 飞书：`oc_xxx[:sender:ou_yyy][:topic:om_zzz]` → `oc_xxx`
 * 其他：原样返回
 */
export function extractRawChatId(channel: string, peerId: string): string {
  if (!peerId) return '';
  if (channel === 'feishu' || channel === 'lark') {
    // 飞书群 peerId 第一段总是 chatId（即使没后缀也是它本身）
    const colonIdx = peerId.indexOf(':');
    return colonIdx > 0 ? peerId.slice(0, colonIdx) : peerId;
  }
  // 其他渠道暂无 scope 后缀
  return peerId;
}

/**
 * 构造跨渠道的 GroupSessionKey：`<channel>:chat:<rawChatId>`
 *
 * 用法：在 channel-message-handler / escalation-service / user-commands 等位置
 * 把消息上下文（channel + peerId）转成 team-mode 用的 key
 */
export function buildGroupSessionKey(channel: string, peerId: string): GroupSessionKey {
  return `${channel}:chat:${extractRawChatId(channel, peerId)}` as GroupSessionKey;
}
