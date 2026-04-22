/**
 * 媒体上传 / 下载
 *
 * 上传：image.create / file.create（大小限制：图片 10M / 文件 30M，SDK 自动分片上传）
 * 下载：messageResource.get（用于入站消息附带的 image_key / file_key）
 */

import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as Lark from '@larksuiteoapi/node-sdk';

/** 支持的飞书 file_type（file.create 的参数枚举） */
type FeishuFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tiff']);

/** 飞书官方上限：image.create 10MB，file.create 30MB（附带留 1MB 余量） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/** 默认缓存目录 */
function defaultCacheDir(): string {
  return path.join(os.tmpdir(), 'evoclaw-feishu-media');
}

/** 根据文件扩展名推断 feishu file_type（音视频/文档/通用流） */
export function inferFileType(filePath: string): FeishuFileType {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.opus':
    case '.m4a':
    case '.mp3':
    case '.wav':
    case '.ogg':
      return 'opus';
    case '.mp4':
    case '.mov':
    case '.m4v':
      return 'mp4';
    case '.pdf':
      return 'pdf';
    case '.doc':
    case '.docx':
      return 'doc';
    case '.xls':
    case '.xlsx':
      return 'xls';
    case '.ppt':
    case '.pptx':
      return 'ppt';
    default:
      return 'stream';
  }
}

/** 判定文件是否为图片（用于选择 image.create 而非 file.create） */
export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

/** 根据 msg_type 推断 message_resource.get 的 type 参数 */
export function resourceTypeFor(msgType: string): 'image' | 'file' {
  return msgType === 'image' ? 'image' : 'file';
}

/** 从本地路径读取为 Buffer（含大小门控，防 OOM / 服务端拒绝） */
async function readBoundedBuffer(filePath: string, maxBytes: number, kind: string): Promise<Buffer> {
  const stat = await fs.stat(filePath);
  if (stat.size === 0) {
    throw new Error(`飞书${kind}上传失败：文件为空 (${filePath})`);
  }
  if (stat.size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    throw new Error(`飞书${kind}上传失败：超出 ${mb}MB 上限 (实际 ${stat.size} 字节)`);
  }
  return await fs.readFile(filePath);
}

/** 上传图片，返回 image_key */
export async function uploadImage(
  client: Lark.Client,
  filePath: string,
): Promise<string> {
  const buf = await readBoundedBuffer(filePath, MAX_IMAGE_BYTES, '图片');
  const res = await client.im.v1.image.create({
    data: { image_type: 'message', image: buf },
  });
  const key = res?.image_key;
  if (!key) throw new Error('飞书图片上传失败：未返回 image_key');
  return key;
}

/** 上传文件，返回 file_key（适用于 file/audio/video） */
export async function uploadFile(
  client: Lark.Client,
  filePath: string,
  options?: { fileType?: FeishuFileType; fileName?: string; duration?: number },
): Promise<string> {
  const buf = await readBoundedBuffer(filePath, MAX_FILE_BYTES, '文件');
  const fileType = options?.fileType ?? inferFileType(filePath);
  const fileName = options?.fileName ?? path.basename(filePath);
  const res = await client.im.v1.file.create({
    data: {
      file_type: fileType,
      file_name: fileName,
      file: buf,
      ...(options?.duration !== undefined ? { duration: options.duration } : {}),
    },
  });
  const key = res?.file_key;
  if (!key) throw new Error('飞书文件上传失败：未返回 file_key');
  return key;
}

/**
 * 下载消息中的媒体资源到本地缓存目录，返回本地路径
 *
 * SDK `client.im.v1.messageResource.get` 用 axios `responseType: 'stream'`，
 * 在 Bun 运行时下长连接会触发 `The socket connection was closed unexpectedly`
 * （ECONNRESET，类似 im.v1.message.get 的包装层兼容 bug）。
 *
 * 这里绕过 SDK 强类型包装，走 `client.request` 手写 URL + `responseType:
 * 'arraybuffer'` 一次性拿完整二进制 body。一张图片通常 <10MB，不会产生内存压力。
 */
export async function downloadMessageResource(
  client: Lark.Client,
  params: {
    messageId: string;
    fileKey: string;
    msgType: string;
    cacheDir?: string;
    fileName?: string;
  },
): Promise<{ path: string; mimeType: string | null }> {
  const cacheDir = params.cacheDir ?? defaultCacheDir();
  await fs.mkdir(cacheDir, { recursive: true });

  const type = resourceTypeFor(params.msgType);
  const url =
    `/open-apis/im/v1/messages/${encodeURIComponent(params.messageId)}` +
    `/resources/${encodeURIComponent(params.fileKey)}`;

  // 用 client.request 低层 API 绕过 SDK 的 stream response 兼容坑
  // $return_headers 让响应同时返回 headers（用来拿 Content-Type）
  const res = (await (client as unknown as {
    request: (options: {
      url: string;
      method: string;
      params?: Record<string, unknown>;
      responseType?: string;
      $return_headers?: boolean;
    }) => Promise<{
      data: ArrayBuffer | Uint8Array | Buffer;
      headers: Record<string, string | string[] | undefined>;
    }>;
  }).request({
    url,
    method: 'GET',
    params: { type },
    responseType: 'arraybuffer',
    $return_headers: true,
  }));

  const buffer = Buffer.isBuffer(res.data)
    ? res.data
    : Buffer.from(res.data as ArrayBuffer);

  const ext = extForType(params.msgType, params.fileName);
  const safeName = `${params.messageId}_${sanitizeKey(params.fileKey)}${ext}`;
  const outPath = path.join(cacheDir, safeName);
  await fs.writeFile(outPath, buffer);

  const mimeType = extractMimeType(res.headers);
  return { path: outPath, mimeType };
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40);
}

function extForType(msgType: string, fileName?: string): string {
  if (fileName && path.extname(fileName)) return path.extname(fileName);
  switch (msgType) {
    case 'image':
      return '.jpg';
    case 'audio':
      return '.opus';
    case 'media':
      return '.mp4';
    default:
      return '.bin';
  }
}

function extractMimeType(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as Record<string, string | string[] | undefined>;
  const raw = h['content-type'] ?? h['Content-Type'];
  if (!raw) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value.split(';')[0]!.trim() : null;
}

/** 清理缓存目录（测试用或周期性维护） */
export async function cleanupMediaCache(cacheDir?: string): Promise<void> {
  const dir = cacheDir ?? defaultCacheDir();
  try {
    if (fsSync.existsSync(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  } catch {
    // 静默失败
  }
}
