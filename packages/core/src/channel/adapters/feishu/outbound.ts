/**
 * 出站消息发送
 *
 * 支持：
 * - sendTextMessage  纯文本
 * - sendPostMessage  Post 富文本（payload 已构造完成）
 * - sendSmartMessage Markdown → Post（识别特征自动渲染，内容错降级纯文本）
 * - sendImageMessage / sendFileMessage / sendMediaMessage 媒体上传后发送
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { buildPostPayload, looksLikeMarkdown, serializePostContent } from './markdown-to-post.js';
import { isImageFile, uploadFile, uploadImage } from './media.js';
import { parseFeishuGroupPeerId } from './session-key.js';

/** 飞书发送 API 返回（部分字段） */
interface FeishuSendResponse {
  code?: number;
  msg?: string;
}

/** 自定义错误：保留飞书 code 便于上层判断是否降级 */
export class FeishuApiError extends Error {
  constructor(
    public readonly action: string,
    public readonly code: number,
    public readonly msg: string,
  ) {
    super(`飞书${action}失败: code=${code} msg=${msg}`);
    this.name = 'FeishuApiError';
  }
}

/** 长回复阈值：超过则走 streaming card，提升感知体验 */
export const STREAMING_CARD_THRESHOLD = 500;

/**
 * Post 内容被服务端拒绝的 code 集合（可降级为纯文本）
 * - 230001 参数错误
 * - 230002 content 格式非法
 * - 230003 参数过长
 * - 230011 / 230012 content 结构错误
 * 其他 code（网络、权限、限流等）不应降级，避免双发
 */
const POST_FALLBACK_CODES = new Set([230001, 230002, 230003, 230011, 230012]);

/** 根据 chatType 推断 receive_id_type */
export function inferReceiveIdType(
  chatType?: 'private' | 'group',
): 'open_id' | 'chat_id' {
  return chatType === 'group' ? 'chat_id' : 'open_id';
}

/**
 * 把业务层 peerId（可能被 session scope 重写为 `oc_x:sender:ou_u` 等）
 * 还原为飞书 API 能识别的原始 receive_id。
 *
 * - chatType='private'：peerId 直接是 open_id
 * - chatType='group'：去掉 :sender:/:topic: 后缀，只取 chatId
 */
export function resolveFeishuReceiveId(
  peerId: string,
  chatType?: 'private' | 'group',
): string {
  if (chatType !== 'group') return peerId;
  if (!peerId.includes(':')) return peerId;
  const parsed = parseFeishuGroupPeerId(peerId);
  return parsed?.chatId ?? peerId;
}

function throwIfError(res: FeishuSendResponse, action: string): void {
  if (res.code) {
    throw new FeishuApiError(action, res.code, res.msg ?? '');
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
      receive_id: resolveFeishuReceiveId(args.peerId, args.chatType),
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
 *
 * 降级策略：仅在"Post 内容被飞书判非法"（code in POST_FALLBACK_CODES）时
 * 回退到纯文本发送；网络错误 / 权限错误 / 限流等一律上抛，避免重复投递。
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
  } catch (err) {
    if (err instanceof FeishuApiError && POST_FALLBACK_CODES.has(err.code)) {
      await sendTextMessage(client, peerId, content, chatType);
      return;
    }
    throw err;
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
