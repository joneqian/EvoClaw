/**
 * 交互卡片发送 / 更新
 *
 * 飞书 interactive 消息 content 直接是卡片 JSON 字符串（顶层不再裹 text/post 外壳）。
 * Topic threading：同 outbound/index.ts，通过 resolveFeishuOutboundRoute + sendByRoute
 * 让卡片在话题内也能保持线程。
 *
 * 参考 https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import {
  FeishuApiError,
  resolveFeishuOutboundRoute,
  sendByRoute,
} from '../outbound/index.js';

/** 飞书交互卡片（零依赖，不绑死 SDK 类型便于测试） */
export interface FeishuCard {
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
    update_multi?: boolean;
  };
  header?: {
    title: { tag: 'plain_text'; content: string };
    template?:
      | 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow'
      | 'orange' | 'red' | 'carmine' | 'violet' | 'purple'
      | 'indigo' | 'grey';
  };
  elements?: unknown[];
  i18n_elements?: Record<string, unknown[]>;
}

interface FeishuSendResponse {
  code?: number;
  msg?: string;
  data?: { message_id?: string };
}

/** 发送交互卡片，返回飞书 message_id（用于后续更新） */
export async function sendInteractiveCard(
  client: Lark.Client,
  peerId: string,
  card: FeishuCard,
  chatType?: 'private' | 'group',
): Promise<string | null> {
  const route = resolveFeishuOutboundRoute(peerId, chatType);
  const { messageId } = await sendByRoute(client, route, 'interactive', JSON.stringify(card));
  return messageId ?? null;
}

/**
 * 更新已发送的卡片（整卡替换）
 *
 * 飞书要求卡片 config.update_multi=true 才能对所有人更新；仅 14 天内发送的消息可改
 */
export async function updateInteractiveCard(
  client: Lark.Client,
  messageId: string,
  card: FeishuCard,
): Promise<void> {
  const res = (await client.im.v1.message.patch({
    path: { message_id: messageId },
    data: { content: JSON.stringify(card) },
  })) as FeishuSendResponse;
  if (res.code) {
    throw new FeishuApiError('更新卡片', res.code, res.msg ?? '');
  }
}
