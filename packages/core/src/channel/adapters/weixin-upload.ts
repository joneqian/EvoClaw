/**
 * 微信 CDN 上传工具
 *
 * 处理文件加密上传到微信 CDN (图片/视频/文件)。
 * 参考: @tencent-weixin/openclaw-weixin src/cdn/upload.ts + src/cdn/cdn-upload.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLogger } from '../../infrastructure/logger.js';
import { encryptAesEcb, aesEcbPaddedSize } from './weixin-crypto.js';
import { buildCdnUploadUrl } from './weixin-cdn.js';
import { getUploadUrl } from './weixin-api.js';
import { getMimeFromFilename, getMediaItemType } from './weixin-mime.js';
import type { WeixinCredentials, UploadedMediaInfo } from './weixin-types.js';
import { CDN_BASE_URL, UploadMediaType, WeixinItemType } from './weixin-types.js';

const log = createLogger('weixin-upload');

/** CDN 上传最大重试次数 */
const UPLOAD_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// CDN 上传核心
// ---------------------------------------------------------------------------

/**
 * 将加密 Buffer 上传到微信 CDN
 * 返回 CDN 下载参数 (x-encrypted-param 响应头)
 */
async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadParam: string;
  filekey: string;
  cdnBaseUrl: string;
  aesKey: Buffer;
  label: string;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadParam, filekey, cdnBaseUrl, aesKey, label } = params;

  // AES-128-ECB 加密
  const ciphertext = encryptAesEcb(buf, aesKey);
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });
  log.debug(`${label}: CDN POST ciphertextSize=${ciphertext.length}`);

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      });

      // 4xx 客户端错误，不重试
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get('x-error-message') ?? (await res.text());
        throw new Error(`CDN 上传客户端错误 ${res.status}: ${errMsg}`);
      }

      if (res.status !== 200) {
        const errMsg = res.headers.get('x-error-message') ?? `status ${res.status}`;
        throw new Error(`CDN 上传服务端错误: ${errMsg}`);
      }

      downloadParam = res.headers.get('x-encrypted-param') ?? undefined;
      if (!downloadParam) {
        throw new Error('CDN 上传响应缺少 x-encrypted-param 头');
      }

      log.debug(`${label}: CDN 上传成功 attempt=${attempt}`);
      break;
    } catch (err) {
      lastError = err;
      // 客户端错误不重试
      if (err instanceof Error && err.message.includes('客户端错误')) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        log.warn(`${label}: 上传尝试 ${attempt} 失败，重试中... err=${String(err)}`);
      } else {
        log.error(`${label}: 全部 ${UPLOAD_MAX_RETRIES} 次尝试失败 err=${String(err)}`);
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN 上传失败，已重试 ${UPLOAD_MAX_RETRIES} 次`);
  }

  return { downloadParam };
}

// ---------------------------------------------------------------------------
// 文件上传管线
// ---------------------------------------------------------------------------

/**
 * 上传文件到微信 CDN
 *
 * 流程: 读取文件 → MD5 → 生成随机 AES key + filekey → getUploadUrl → AES 加密上传 → 返回媒体信息
 */
export async function uploadFileToWeixin(params: {
  filePath: string;
  toUserId: string;
  credentials: WeixinCredentials;
  cdnBaseUrl?: string;
}): Promise<UploadedMediaInfo> {
  const { filePath, toUserId, credentials, cdnBaseUrl } = params;
  const cdnBase = cdnBaseUrl ?? CDN_BASE_URL;

  // 读取文件
  const plaintext = await fs.readFile(filePath);
  const rawSize = plaintext.length;
  const rawMd5 = crypto.createHash('md5').update(plaintext).digest('hex');
  const cipherSize = aesEcbPaddedSize(rawSize);
  const filekey = crypto.randomBytes(16).toString('hex');
  const aesKey = crypto.randomBytes(16);
  const aesKeyHex = aesKey.toString('hex');

  // 根据 MIME 确定上传媒体类型
  const mime = getMimeFromFilename(filePath);
  const itemType = getMediaItemType(mime);
  let mediaType: number;
  switch (itemType) {
    case WeixinItemType.IMAGE:
      mediaType = UploadMediaType.IMAGE;
      break;
    case WeixinItemType.VIDEO:
      mediaType = UploadMediaType.VIDEO;
      break;
    default:
      mediaType = UploadMediaType.FILE;
      break;
  }

  log.debug(
    `上传文件: ${filePath} rawSize=${rawSize} cipherSize=${cipherSize} md5=${rawMd5} mediaType=${mediaType}`,
  );

  // 获取上传 URL
  const uploadUrlResp = await getUploadUrl({
    baseUrl: credentials.baseUrl,
    token: credentials.botToken,
    filekey,
    mediaType,
    toUserId,
    rawSize,
    rawMd5,
    cipherSize,
    aesKeyHex,
  });

  const uploadParam = uploadUrlResp.upload_param;
  if (!uploadParam) {
    throw new Error('getUploadUrl 返回空 upload_param');
  }

  // 上传到 CDN
  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam,
    filekey,
    cdnBaseUrl: cdnBase,
    aesKey,
    label: 'uploadFileToWeixin',
  });

  return {
    downloadEncryptedQueryParam: downloadParam,
    aesKey: aesKeyHex,
    fileKey: filekey,
    rawSize,
    cipherSize,
    md5: rawMd5,
  };
}

// ---------------------------------------------------------------------------
// 远程文件下载
// ---------------------------------------------------------------------------

/** 媒体临时目录 */
const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'evoclaw-media');

/**
 * 下载远程 URL 到临时文件
 * 返回本地文件路径
 */
export async function downloadRemoteToTemp(url: string): Promise<string> {
  log.debug(`下载远程文件: ${url.substring(0, 100)}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`远程文件下载失败: HTTP ${res.status} ${res.statusText}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(TEMP_MEDIA_DIR, { recursive: true });

  // 从 URL 或 Content-Type 推断扩展名
  const contentType = res.headers.get('content-type');
  let ext = '.bin';
  if (contentType) {
    // 简单映射常见类型
    const ctMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf',
    };
    ext = ctMap[contentType.split(';')[0]?.trim() ?? ''] ?? ext;
  }
  if (ext === '.bin') {
    // 尝试从 URL 路径推断
    const urlPath = new URL(url).pathname;
    const dot = urlPath.lastIndexOf('.');
    if (dot >= 0) {
      ext = urlPath.substring(dot).toLowerCase().split('?')[0] ?? ext;
    }
  }

  const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const filePath = path.join(TEMP_MEDIA_DIR, uniqueName);
  await fs.writeFile(filePath, buf);

  log.debug(`远程文件已保存: ${filePath} (${buf.length} bytes)`);
  return filePath;
}
