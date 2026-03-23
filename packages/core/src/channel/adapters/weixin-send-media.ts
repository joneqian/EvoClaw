/**
 * 微信媒体消息发送
 *
 * 根据 MIME 类型构建对应的消息项 (image_item/video_item/file_item)，
 * 通过 sendMessage API 发送到微信。
 * 参考: @tencent-weixin/openclaw-weixin src/messaging/send.ts + src/messaging/send-media.ts
 */

import path from 'node:path';

import { createLogger } from '../../infrastructure/logger.js';
import { sendMessage } from './weixin-api.js';
import { uploadFileToWeixin } from './weixin-upload.js';
import { getMimeFromFilename } from './weixin-mime.js';
import type {
  WeixinCredentials,
  WeixinMessageItem,
  UploadedMediaInfo,
} from './weixin-types.js';
import { WeixinItemType } from './weixin-types.js';

const log = createLogger('weixin-send-media');

// ---------------------------------------------------------------------------
// 媒体消息构建
// ---------------------------------------------------------------------------

/** 构建图片消息项 */
function buildImageItem(uploaded: UploadedMediaInfo): WeixinMessageItem {
  return {
    type: WeixinItemType.IMAGE,
    image_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aesKey, 'hex').toString('base64'),
        encrypt_type: 1,
      },
      mid_size: uploaded.cipherSize,
    },
  };
}

/** 构建视频消息项 */
function buildVideoItem(uploaded: UploadedMediaInfo): WeixinMessageItem {
  return {
    type: WeixinItemType.VIDEO,
    video_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aesKey, 'hex').toString('base64'),
        encrypt_type: 1,
      },
      video_size: uploaded.cipherSize,
    },
  };
}

/** 构建文件消息项 */
function buildFileItem(uploaded: UploadedMediaInfo, fileName: string): WeixinMessageItem {
  return {
    type: WeixinItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: Buffer.from(uploaded.aesKey, 'hex').toString('base64'),
        encrypt_type: 1,
      },
      file_name: fileName,
      len: String(uploaded.rawSize),
    },
  };
}

// ---------------------------------------------------------------------------
// 媒体消息发送
// ---------------------------------------------------------------------------

/** 发送图片消息 */
export async function sendImageMessage(opts: {
  toUserId: string;
  uploaded: UploadedMediaInfo;
  text?: string;
  credentials: WeixinCredentials;
  contextToken?: string;
}): Promise<void> {
  const { toUserId, uploaded, text, credentials, contextToken } = opts;
  const items: WeixinMessageItem[] = [];

  // 文本说明 (可选)
  if (text) {
    items.push({ type: WeixinItemType.TEXT, text_item: { text } });
  }
  items.push(buildImageItem(uploaded));

  // 逐项发送 (每条消息只含一个 item)
  for (const item of items) {
    await sendMessage({
      baseUrl: credentials.baseUrl,
      token: credentials.botToken,
      toUserId,
      contextToken,
      itemList: [item],
    });
  }

  log.info(`图片消息已发送到 ${toUserId}`);
}

/** 发送视频消息 */
export async function sendVideoMessage(opts: {
  toUserId: string;
  uploaded: UploadedMediaInfo;
  text?: string;
  credentials: WeixinCredentials;
  contextToken?: string;
}): Promise<void> {
  const { toUserId, uploaded, text, credentials, contextToken } = opts;
  const items: WeixinMessageItem[] = [];

  if (text) {
    items.push({ type: WeixinItemType.TEXT, text_item: { text } });
  }
  items.push(buildVideoItem(uploaded));

  for (const item of items) {
    await sendMessage({
      baseUrl: credentials.baseUrl,
      token: credentials.botToken,
      toUserId,
      contextToken,
      itemList: [item],
    });
  }

  log.info(`视频消息已发送到 ${toUserId}`);
}

/** 发送文件消息 */
export async function sendFileMessage(opts: {
  toUserId: string;
  uploaded: UploadedMediaInfo;
  fileName: string;
  text?: string;
  credentials: WeixinCredentials;
  contextToken?: string;
}): Promise<void> {
  const { toUserId, uploaded, fileName, text, credentials, contextToken } = opts;
  const items: WeixinMessageItem[] = [];

  if (text) {
    items.push({ type: WeixinItemType.TEXT, text_item: { text } });
  }
  items.push(buildFileItem(uploaded, fileName));

  for (const item of items) {
    await sendMessage({
      baseUrl: credentials.baseUrl,
      token: credentials.botToken,
      toUserId,
      contextToken,
      itemList: [item],
    });
  }

  log.info(`文件消息已发送到 ${toUserId}: ${fileName}`);
}

// ---------------------------------------------------------------------------
// 统一发送入口
// ---------------------------------------------------------------------------

/**
 * 统一媒体文件发送
 *
 * 流程: 检测 MIME → 上传到 CDN → 根据类型路由到对应发送函数
 */
export async function sendWeixinMediaFile(params: {
  filePath: string;
  toUserId: string;
  text?: string;
  credentials: WeixinCredentials;
  contextToken?: string;
  cdnBaseUrl?: string;
}): Promise<void> {
  const { filePath, toUserId, text, credentials, contextToken, cdnBaseUrl } = params;

  const mime = getMimeFromFilename(filePath);
  log.info(`发送媒体文件: ${filePath} mime=${mime} to=${toUserId}`);

  // 上传到 CDN
  const uploaded = await uploadFileToWeixin({
    filePath,
    toUserId,
    credentials,
    cdnBaseUrl,
  });

  log.info(`CDN 上传完成: fileKey=${uploaded.fileKey} rawSize=${uploaded.rawSize}`);

  // 根据 MIME 类型路由
  if (mime.startsWith('image/')) {
    await sendImageMessage({ toUserId, uploaded, text, credentials, contextToken });
  } else if (mime.startsWith('video/')) {
    await sendVideoMessage({ toUserId, uploaded, text, credentials, contextToken });
  } else {
    const fileName = path.basename(filePath);
    await sendFileMessage({ toUserId, uploaded, fileName, text, credentials, contextToken });
  }
}
