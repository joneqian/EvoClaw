/**
 * 微信 CDN 加解密工具 — AES-128-ECB
 *
 * 所有微信媒体 (图片/语音/文件/视频) 通过 CDN 传输时使用 AES-128-ECB 加密。
 * 参考: @tencent-weixin/openclaw-weixin src/cdn/aes-ecb.ts + src/cdn/pic-decrypt.ts
 */

import { createCipheriv, createDecipheriv } from 'node:crypto';

import type { WeixinImageItem, WeixinMessageItem } from './weixin-types.js';
import { WeixinItemType } from './weixin-types.js';

// ---------------------------------------------------------------------------
// AES-128-ECB 加解密
// ---------------------------------------------------------------------------

/** AES-128-ECB 加密 (PKCS7 padding) */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** AES-128-ECB 解密 (PKCS7 padding) */
export function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** 计算 AES-128-ECB 密文大小 (PKCS7 padding 到 16 字节边界) */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

// ---------------------------------------------------------------------------
// AES Key 解析 — 两种编码格式
// ---------------------------------------------------------------------------

/**
 * 从消息项中解析 AES-128 密钥
 *
 * 两种编码格式:
 * 1. IMAGE: `image_item.aeskey` 是 hex 字符串 (32 hex chars = 16 bytes)
 * 2. 其他 (VOICE/FILE/VIDEO): `media.aes_key` 是 base64 编码
 *
 * 参考: openclaw-weixin src/cdn/pic-decrypt.ts parseAesKey
 */
export function parseAesKeyFromItem(item: WeixinMessageItem): Buffer | null {
  if (item.type === WeixinItemType.IMAGE) {
    // IMAGE 优先使用 image_item.aeskey (hex 字符串)
    const imageItem = item.image_item as WeixinImageItem | undefined;
    const hexKey = imageItem?.aeskey;
    if (hexKey && hexKey.length === 32) {
      return Buffer.from(hexKey, 'hex');
    }
    // fallback 到 media.aes_key
    const b64Key = imageItem?.media?.aes_key;
    if (b64Key) {
      return Buffer.from(b64Key, 'base64');
    }
    return null;
  }

  // VOICE/FILE/VIDEO: 使用 media.aes_key (base64)
  const media =
    item.voice_item?.media ??
    item.file_item?.media ??
    item.video_item?.media;

  const b64Key = media?.aes_key;
  if (!b64Key) return null;

  return Buffer.from(b64Key, 'base64');
}

/**
 * 从消息项中获取 CDN 下载参数
 */
export function getEncryptQueryParam(item: WeixinMessageItem): string | undefined {
  switch (item.type) {
    case WeixinItemType.IMAGE:
      return item.image_item?.media?.encrypt_query_param;
    case WeixinItemType.VOICE:
      return item.voice_item?.media?.encrypt_query_param;
    case WeixinItemType.FILE:
      return item.file_item?.media?.encrypt_query_param;
    case WeixinItemType.VIDEO:
      return item.video_item?.media?.encrypt_query_param;
    default:
      return undefined;
  }
}
