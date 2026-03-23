/**
 * 微信 CDN 下载工具
 *
 * 处理从微信 CDN 下载和解密媒体文件 (图片/语音/文件/视频)。
 * 参考: @tencent-weixin/openclaw-weixin src/cdn/pic-decrypt.ts + src/cdn/cdn-url.ts
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { createLogger } from '../../infrastructure/logger.js';
import { decryptAesEcb } from './weixin-crypto.js';
import { parseAesKeyFromItem, getEncryptQueryParam } from './weixin-crypto.js';
import { getMimeFromFilename, getExtensionFromMime } from './weixin-mime.js';
import type { WeixinMessageItem } from './weixin-types.js';
import { CDN_BASE_URL, WeixinItemType } from './weixin-types.js';

const log = createLogger('weixin-cdn');

// ---------------------------------------------------------------------------
// CDN URL 构建
// ---------------------------------------------------------------------------

/** 构建 CDN 下载 URL */
export function buildCdnDownloadUrl(encryptedQueryParam: string, cdnBaseUrl?: string): string {
  const base = cdnBaseUrl ?? CDN_BASE_URL;
  return `${base}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/** 构建 CDN 上传 URL */
export function buildCdnUploadUrl(params: {
  cdnBaseUrl?: string;
  uploadParam: string;
  filekey: string;
}): string {
  const base = params.cdnBaseUrl ?? CDN_BASE_URL;
  return `${base}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

// ---------------------------------------------------------------------------
// CDN 下载 + 解密
// ---------------------------------------------------------------------------

/**
 * 从 CDN 下载并解密媒体文件
 * AES-128-ECB 解密，返回明文 Buffer
 */
export async function downloadAndDecryptMedia(params: {
  encryptedQueryParam: string;
  aesKey: Buffer;
  cdnBaseUrl?: string;
}): Promise<Buffer> {
  const url = buildCdnDownloadUrl(params.encryptedQueryParam, params.cdnBaseUrl);
  log.debug(`下载 CDN 媒体: ${url.substring(0, 80)}...`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    throw new Error(`CDN 下载失败: HTTP ${res.status} ${body.substring(0, 200)}`);
  }

  const encrypted = Buffer.from(await res.arrayBuffer());
  log.debug(`CDN 下载完成: ${encrypted.length} bytes，开始解密`);

  const decrypted = decryptAesEcb(encrypted, params.aesKey);
  log.debug(`解密完成: ${decrypted.length} bytes`);

  return decrypted;
}

// ---------------------------------------------------------------------------
// 临时文件保存
// ---------------------------------------------------------------------------

/** 媒体临时目录 */
const TEMP_MEDIA_DIR = path.join(os.tmpdir(), 'evoclaw-media');

/**
 * 将 Buffer 保存到临时文件
 * 返回文件路径
 */
export async function saveMediaToTemp(buffer: Buffer, extension: string): Promise<string> {
  await fs.mkdir(TEMP_MEDIA_DIR, { recursive: true });
  const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
  const filePath = path.join(TEMP_MEDIA_DIR, uniqueName);
  await fs.writeFile(filePath, buffer);
  log.debug(`媒体已保存到临时文件: ${filePath} (${buffer.length} bytes)`);
  return filePath;
}

// ---------------------------------------------------------------------------
// 消息项媒体下载
// ---------------------------------------------------------------------------

/** 根据消息项类型推断 MIME 类型 */
function getMimeTypeFromItem(item: WeixinMessageItem): string {
  switch (item.type) {
    case WeixinItemType.IMAGE:
      return 'image/jpeg'; // 默认 JPEG
    case WeixinItemType.VOICE:
      return 'audio/silk';
    case WeixinItemType.VIDEO:
      return 'video/mp4';
    case WeixinItemType.FILE: {
      const fileName = item.file_item?.file_name;
      return fileName ? getMimeFromFilename(fileName) : 'application/octet-stream';
    }
    default:
      return 'application/octet-stream';
  }
}

/**
 * 从消息项下载媒体文件
 * 自动解析 AES key、CDN 参数，下载解密后保存到临时文件
 * 返回 null 表示该消息项没有可下载的媒体
 */
export async function downloadMediaFromItem(
  item: WeixinMessageItem,
  opts: { cdnBaseUrl?: string },
): Promise<{ filePath: string; mimeType: string } | null> {
  // 检查是否为媒体类型
  const mediaTypes = [WeixinItemType.IMAGE, WeixinItemType.VOICE, WeixinItemType.FILE, WeixinItemType.VIDEO];
  if (!item.type || !(mediaTypes as readonly number[]).includes(item.type)) {
    return null;
  }

  // 获取加密查询参数
  const encryptQueryParam = getEncryptQueryParam(item);
  if (!encryptQueryParam) {
    log.debug(`消息项缺少 encrypt_query_param，跳过下载: type=${item.type}`);
    return null;
  }

  // 解析 AES key
  const aesKey = parseAesKeyFromItem(item);
  if (!aesKey) {
    log.debug(`消息项缺少 AES key，跳过下载: type=${item.type}`);
    return null;
  }

  // 下载并解密
  const buffer = await downloadAndDecryptMedia({
    encryptedQueryParam: encryptQueryParam,
    aesKey,
    cdnBaseUrl: opts.cdnBaseUrl,
  });

  // 确定 MIME 类型和扩展名
  const mimeType = getMimeTypeFromItem(item);
  const extension = getExtensionFromMime(mimeType);

  // 保存到临时文件
  const filePath = await saveMediaToTemp(buffer, extension);

  return { filePath, mimeType };
}
