/**
 * 出站消息发送
 *
 * 支持：
 * - sendTextMessage  纯文本
 * - sendPostMessage  Post 富文本（payload 已构造完成）
 * - sendSmartMessage Markdown → Post（识别特征自动渲染，内容错降级纯文本）
 * - sendImageMessage / sendFileMessage / sendMediaMessage 媒体上传后发送
 *
 * Topic threading：当 peerId 由 buildFeishuGroupPeerId 编入 threadId 时
 * （`<chatId>:topic:<threadId>` 等），通过 thread-anchor 注册表查最近一条话题
 * 内消息的 message_id 作锚点，走 `im.v1.message.reply` + `reply_in_thread: true`
 * 让回复留在话题线程内（飞书 API 不接受 receive_id_type='thread_id'）。
 *
 * 锚点缺失时降级为 chat_id create（消息会掉出话题，但比抛错好），log.warn 提醒。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { buildPostPayload, looksLikeMarkdown, serializePostContent } from './markdown-to-post.js';
import { isImageFile, uploadFile, uploadImage } from './media.js';
import { parseFeishuGroupPeerId } from '../common/session-key.js';
import { getThreadAnchor } from './thread-anchor.js';
import { createLogger } from '../../../../infrastructure/logger.js';

const log = createLogger('feishu-outbound');

/** 飞书发送 API 返回（部分字段） */
interface FeishuSendResponse {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
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

/**
 * Post 内容被服务端拒绝的 code 集合（可降级为纯文本）
 * - 230001 参数错误
 * - 230002 content 格式非法
 * - 230003 参数过长
 * - 230011 / 230012 content 结构错误
 * 其他 code（网络、权限、限流等）不应降级，避免双发
 */
const POST_FALLBACK_CODES = new Set([230001, 230002, 230003, 230011, 230012]);

/**
 * 出站路由：决定调用哪个 Feishu API。
 *
 * - `create` 走 `im.v1.message.create`（标准发送）
 * - `reply` 走 `im.v1.message.reply` + reply_in_thread=true（topic 内才能保线程）
 */
export type FeishuOutboundRoute =
  | { kind: 'create'; receiveId: string; receiveIdType: 'open_id' | 'chat_id' }
  | { kind: 'reply'; parentMessageId: string };

/**
 * 根据 peerId + chatType 决定出站路由。
 *
 * 决策树：
 * 1. private / 未指定 → create + open_id
 * 2. group 无 ':' 后缀 → create + chat_id（直接是 chatId）
 * 3. group 含 ':topic:' → 查 thread-anchor
 *    - 命中 → reply（让消息留在话题）
 *    - 未命中 → 降级 create + chat_id（消息掉出话题，log.warn）
 * 4. group 含 ':sender:' 但无 topic → create + chat_id（剥离 sender）
 * 5. 解析失败 → create + chat_id 兜底
 */
export function resolveFeishuOutboundRoute(
  peerId: string,
  chatType?: 'private' | 'group',
): FeishuOutboundRoute {
  if (chatType !== 'group') {
    return { kind: 'create', receiveId: peerId, receiveIdType: 'open_id' };
  }

  if (!peerId.includes(':')) {
    return { kind: 'create', receiveId: peerId, receiveIdType: 'chat_id' };
  }

  const parsed = parseFeishuGroupPeerId(peerId);
  if (!parsed) {
    return { kind: 'create', receiveId: peerId, receiveIdType: 'chat_id' };
  }

  if (parsed.threadId) {
    const anchor = getThreadAnchor(parsed.chatId, parsed.threadId);
    if (anchor) {
      return { kind: 'reply', parentMessageId: anchor };
    }
    // 锚点缺失：可能是 sidecar 重启后 inbound 还没收到此话题的消息。
    // 降级为 chat_id create，回复会掉到群主流——比抛错让用户白等好。
    log.warn(
      `[outbound] topic peerId 但 thread anchor 未注册，降级为 chat_id 路径（消息可能掉出话题） chatId=${parsed.chatId} threadId=${parsed.threadId}`,
    );
  }

  return { kind: 'create', receiveId: parsed.chatId, receiveIdType: 'chat_id' };
}

/**
 * 旧 API：根据 chatType 推断 receive_id_type
 *
 * @deprecated 内部 outbound 路径已用 resolveFeishuOutboundRoute 替代。
 *   保留导出仅为向后兼容（外部调用方 / 老测试）。
 */
export function inferReceiveIdType(
  chatType?: 'private' | 'group',
): 'open_id' | 'chat_id' {
  return chatType === 'group' ? 'chat_id' : 'open_id';
}

/**
 * 旧 API：把 session scope 后缀剥离回原始 receive_id
 *
 * @deprecated 内部 outbound 路径已用 resolveFeishuOutboundRoute 替代。
 *   注意：本函数对 topic peerId 仅返回 chatId（旧的 buggy 行为），不识别话题线程。
 *   保留导出仅为向后兼容。
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

/**
 * 按路由执行实际发送（dispatch 到 create 或 reply API）。
 *
 * 暴露为 export 给 send-card / cardkit-streaming 等同样需要 thread-aware 发送的
 * 上层调用方使用，避免他们各自重复 dispatch 逻辑。
 */
export async function sendByRoute(
  client: Lark.Client,
  route: FeishuOutboundRoute,
  msgType: string,
  content: string,
): Promise<{ messageId?: string }> {
  log.debug(`[outbound] dispatching route=${route.kind} msgType=${msgType}`);

  if (route.kind === 'reply') {
    const res = (await client.im.v1.message.reply({
      path: { message_id: route.parentMessageId },
      data: {
        content,
        msg_type: msgType,
        reply_in_thread: true,
      },
    })) as FeishuSendResponse;
    throwIfError(res, `回复 ${msgType}（topic）`);
    return { messageId: res.data?.message_id };
  }

  const res = (await client.im.v1.message.create({
    params: { receive_id_type: route.receiveIdType },
    data: {
      receive_id: route.receiveId,
      msg_type: msgType,
      content,
    },
  })) as FeishuSendResponse;
  throwIfError(res, `发送 ${msgType}`);
  return { messageId: res.data?.message_id };
}

async function createMessage(
  client: Lark.Client,
  args: {
    peerId: string;
    chatType?: 'private' | 'group';
    msgType: string;
    content: string;
  },
): Promise<{ messageId?: string }> {
  const route = resolveFeishuOutboundRoute(args.peerId, args.chatType);
  return sendByRoute(client, route, args.msgType, args.content);
}

/** 发送纯文本消息（返回 messageId 给 cross-sidecar 注册表用） */
export async function sendTextMessage(
  client: Lark.Client,
  peerId: string,
  content: string,
  chatType?: 'private' | 'group',
): Promise<{ messageId?: string }> {
  return await createMessage(client, {
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
): Promise<{ messageId?: string }> {
  return await createMessage(client, {
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
): Promise<{ messageId?: string }> {
  if (!looksLikeMarkdown(content)) {
    return await sendTextMessage(client, peerId, content, chatType);
  }

  const payload = buildPostPayload(content);
  try {
    return await sendPostMessage(client, peerId, serializePostContent(payload), chatType);
  } catch (err) {
    if (err instanceof FeishuApiError && POST_FALLBACK_CODES.has(err.code)) {
      return await sendTextMessage(client, peerId, content, chatType);
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
