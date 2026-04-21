/**
 * 飞书群会话隔离策略（4 档）
 *
 * 对应 ChannelMessage.peerId 在群聊（chatType='group'）下的取值：
 * - group               每个群一条会话（默认，机器人在群中共享上下文）
 * - group_sender        群内按发送者分离（每人与机器人独立对话）
 * - group_topic         群内按话题（thread_id）分离
 * - group_topic_sender  群内按「话题 × 发送者」分离（最细粒度）
 *
 * 私聊（p2p）总是按 sender.open_id 分离，不受 scope 影响。
 *
 * 参考 OpenClaw extensions/feishu/src/conversation-id.ts:17-44。
 */

/** 会话隔离策略枚举 */
export type FeishuGroupSessionScope =
  | 'group'
  | 'group_sender'
  | 'group_topic'
  | 'group_topic_sender';

/** 合法值列表（运行时 / UI 选项使用） */
export const FEISHU_GROUP_SESSION_SCOPES: readonly FeishuGroupSessionScope[] = [
  'group',
  'group_sender',
  'group_topic',
  'group_topic_sender',
] as const;

/** 策略中文标签（UI 展示用） */
export const FEISHU_SCOPE_LABELS: Record<FeishuGroupSessionScope, string> = {
  group: '整群共享一个会话',
  group_sender: '群内按成员分离',
  group_topic: '群内按话题分离',
  group_topic_sender: '群内按「话题 × 成员」分离',
};

/**
 * 根据 scope 构造群聊场景的 peerId
 *
 * @param chatId 群 chat_id（必填）
 * @param senderOpenId 发送者 open_id（group_sender/group_topic_sender 使用）
 * @param threadId 话题 thread_id（group_topic/group_topic_sender 使用，缺失时降级为无 topic 变体）
 */
export function buildFeishuGroupPeerId(params: {
  scope: FeishuGroupSessionScope;
  chatId: string;
  senderOpenId?: string;
  threadId?: string;
}): string {
  const { scope, chatId, senderOpenId, threadId } = params;
  switch (scope) {
    case 'group':
      return chatId;
    case 'group_sender':
      return senderOpenId ? `${chatId}:sender:${senderOpenId}` : chatId;
    case 'group_topic':
      return threadId ? `${chatId}:topic:${threadId}` : chatId;
    case 'group_topic_sender': {
      const topicPart = threadId ? `:topic:${threadId}` : '';
      const senderPart = senderOpenId ? `:sender:${senderOpenId}` : '';
      return `${chatId}${topicPart}${senderPart}`;
    }
  }
}

/**
 * 把带后缀的 peerId 拆解回 chatId + senderOpenId + threadId
 *
 * 用于审计 / 调试。返回 null 表示非群聊格式。
 */
export function parseFeishuGroupPeerId(peerId: string): {
  chatId: string;
  senderOpenId?: string;
  threadId?: string;
} | null {
  if (!peerId) return null;

  const parts = peerId.split(':');
  const chatId = parts[0]!;
  if (!chatId) return null;

  const out: {
    chatId: string;
    senderOpenId?: string;
    threadId?: string;
  } = { chatId };

  for (let i = 1; i < parts.length; i += 2) {
    const k = parts[i];
    const v = parts[i + 1];
    if (!k || !v) break;
    if (k === 'sender') out.senderOpenId = v;
    else if (k === 'topic') out.threadId = v;
  }
  return out;
}
