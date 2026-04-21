/**
 * 出站消息发送
 *
 * 当前支持：
 * - 纯文本 (sendTextMessage)
 * - Post 富文本 (sendPostMessage) — Markdown 自动转 Post，失败降级纯文本
 * - 图片 / 文件 (sendImageMessage / sendFileMessage) — 上传取 key 后发送
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { buildPostPayload, looksLikeMarkdown, serializePostContent } from './markdown-to-post.js';
import { isImageFile, uploadFile, uploadImage } from './media.js';

/** 飞书发送 API 返回（部分字段） */
interface FeishuSendResponse {
  code?: number;
  msg?: string;
}

/** 根据 chatType 推断 receive_id_type */
export function inferReceiveIdType(
  chatType?: 'private' | 'group',
): 'open_id' | 'chat_id' {
  return chatType === 'group' ? 'chat_id' : 'open_id';
}

function throwIfError(res: FeishuSendResponse, action: string): void {
  if (res.code) {
    throw new Error(`飞书${action}失败: code=${res.code} msg=${res.msg ?? ''}`);
  }
}

async function createMessage(
  client: Lark.Client,
  args: {
    peerId: string;
    chatType?: 'private' | 'group';
    msgType: string;
    content: string;
  },
): Promise<void> {
  const res = (await client.im.v1.message.create({
    params: { receive_id_type: inferReceiveIdType(args.chatType) },
    data: {
      receive_id: args.peerId,
      msg_type: args.msgType,
      content: args.content,
    },
  })) as FeishuSendResponse;
  throwIfError(res, `发送 ${args.msgType}`);
}

/** 发送纯文本消息 */
export async function sendTextMessage(
  client: Lark.Client,
  peerId: string,
  content: string,
  chatType?: 'private' | 'group',
): Promise<void> {
  await createMessage(client, {
    peerId,
    chatType,
    msgType: 'text',
    content: JSON.stringify({ text: content }),
  });
}

/**
 * 发送 Post 富文本（输入已经是 Post payload JSON 字符串）
 * 若失败则降级为纯文本
 */
export async function sendPostMessage(
  client: Lark.Client,
  peerId: string,
  postContent: string,
  chatType?: 'private' | 'group',
): Promise<void> {
  await createMessage(client, {
    peerId,
    chatType,
    msgType: 'post',
    content: postContent,
  });
}

/**
 * 智能发送：如果内容看起来是 Markdown，尝试 Post；否则发纯文本
 * Post 发送失败会降级为纯文本重试
 */
export async function sendSmartMessage(
  client: Lark.Client,
  peerId: string,
  content: string,
  chatType?: 'private' | 'group',
): Promise<void> {
  if (!looksLikeMarkdown(content)) {
    await sendTextMessage(client, peerId, content, chatType);
    return;
  }

  const payload = buildPostPayload(content);
  try {
    await sendPostMessage(client, peerId, serializePostContent(payload), chatType);
  } catch {
    // 降级为纯文本
    await sendTextMessage(client, peerId, content, chatType);
  }
}

/** 发送图片（本地路径 → 上传 → 发送） */
export async function sendImageMessage(
  client: Lark.Client,
  peerId: string,
  filePath: string,
  chatType?: 'private' | 'group',
): Promise<void> {
  const imageKey = await uploadImage(client, filePath);
  await createMessage(client, {
    peerId,
    chatType,
    msgType: 'image',
    content: JSON.stringify({ image_key: imageKey }),
  });
}

/** 发送文件（含音视频，由扩展名推断 file_type） */
export async function sendFileMessage(
  client: Lark.Client,
  peerId: string,
  filePath: string,
  chatType?: 'private' | 'group',
  options?: { fileName?: string; duration?: number },
): Promise<void> {
  const fileKey = await uploadFile(client, filePath, options);
  await createMessage(client, {
    peerId,
    chatType,
    msgType: 'file',
    content: JSON.stringify({ file_key: fileKey }),
  });
}

/** 根据 filePath 自动选择 image / file 发送路径 */
export async function sendMediaMessage(
  client: Lark.Client,
  peerId: string,
  filePath: string,
  chatType?: 'private' | 'group',
  options?: { fileName?: string; duration?: number },
): Promise<void> {
  if (isImageFile(filePath)) {
    await sendImageMessage(client, peerId, filePath, chatType);
  } else {
    await sendFileMessage(client, peerId, filePath, chatType, options);
  }
}
