/**
 * MIME 类型检测工具
 *
 * 参考: @tencent-weixin/openclaw-weixin src/media/mime.ts
 */

import { WeixinItemType } from './weixin-types.js';

// ---------------------------------------------------------------------------
// 扩展名 → MIME 映射
// ---------------------------------------------------------------------------

const MIME_MAP: Record<string, string> = {
  // 图片
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  // 视频
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  // 音频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.silk': 'audio/silk',
  '.amr': 'audio/amr',
  // 文档
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.md': 'text/markdown',
  // 压缩
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

// MIME → 扩展名 反向映射
const EXTENSION_MAP: Record<string, string> = {};
for (const [ext, mime] of Object.entries(MIME_MAP)) {
  if (!(mime in EXTENSION_MAP)) {
    EXTENSION_MAP[mime] = ext;
  }
}

// ---------------------------------------------------------------------------
// 公共函数
// ---------------------------------------------------------------------------

/** 从文件名获取 MIME 类型 */
export function getMimeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = filename.substring(dot).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/** 从 MIME 类型获取文件扩展名 */
export function getExtensionFromMime(mime: string): string {
  return EXTENSION_MAP[mime] ?? '.bin';
}

/**
 * 从 MIME 类型推断 iLink 消息项类型
 *
 * image/* → IMAGE(2), video/* → VIDEO(5), 其他 → FILE(4)
 */
export function getMediaItemType(mime: string): number {
  if (mime.startsWith('image/')) return WeixinItemType.IMAGE;
  if (mime.startsWith('video/')) return WeixinItemType.VIDEO;
  return WeixinItemType.FILE;
}
