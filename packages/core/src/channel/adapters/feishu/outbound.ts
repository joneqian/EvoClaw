/**
 * 出站消息发送
 *
 * PR1 仅支持纯文本发送，Markdown→Post / 卡片 / 媒体在后续 PR 扩展。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';

/** 根据 chatType 推断 receive_id_type */
export function inferReceiveIdType(
  chatType?: 'private' | 'group',
): 'open_id' | 'chat_id' {
  return chatType === 'group' ? 'chat_id' : 'open_id';
}

/**
 * 通过飞书 IM API 发送纯文本消息
 *
 * @throws 当飞书返回 code !== 0 或网络失败
 */
export async function sendTextMessage(
  client: Lark.Client,
  peerId: string,
  content: string,
  chatType?: 'private' | 'group',
): Promise<void> {
  const res = await client.im.v1.message.create({
    params: {
      receive_id_type: inferReceiveIdType(chatType),
    },
    data: {
      receive_id: peerId,
      msg_type: 'text',
      content: JSON.stringify({ text: content }),
    },
  });

  if (res.code !== undefined && res.code !== 0) {
    throw new Error(`飞书发送失败: code=${res.code} msg=${res.msg ?? ''}`);
  }
}
