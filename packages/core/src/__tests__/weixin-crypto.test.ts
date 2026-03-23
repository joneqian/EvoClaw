import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  encryptAesEcb,
  decryptAesEcb,
  aesEcbPaddedSize,
  parseAesKeyFromItem,
  getEncryptQueryParam,
} from '../channel/adapters/weixin-crypto.js';
import type { WeixinMessageItem } from '../channel/adapters/weixin-types.js';

describe('AES-128-ECB', () => {
  const key = crypto.randomBytes(16);

  it('加密 → 解密 往返应还原明文', () => {
    const plaintext = Buffer.from('Hello, 微信!');
    const ciphertext = encryptAesEcb(plaintext, key);
    const decrypted = decryptAesEcb(ciphertext, key);
    expect(decrypted.toString()).toBe('Hello, 微信!');
  });

  it('空 Buffer 应正确处理', () => {
    const plaintext = Buffer.alloc(0);
    const ciphertext = encryptAesEcb(plaintext, key);
    const decrypted = decryptAesEcb(ciphertext, key);
    expect(decrypted.length).toBe(0);
  });

  it('大数据块应正确加解密', () => {
    const plaintext = crypto.randomBytes(10000);
    const ciphertext = encryptAesEcb(plaintext, key);
    const decrypted = decryptAesEcb(ciphertext, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('密文长度应为 16 字节对齐', () => {
    for (const size of [1, 15, 16, 17, 31, 32, 100]) {
      const plaintext = crypto.randomBytes(size);
      const ciphertext = encryptAesEcb(plaintext, key);
      expect(ciphertext.length % 16).toBe(0);
    }
  });
});

describe('aesEcbPaddedSize', () => {
  it('应计算正确的 PKCS7 密文大小', () => {
    expect(aesEcbPaddedSize(0)).toBe(16);   // 0 → 16 bytes padding
    expect(aesEcbPaddedSize(1)).toBe(16);
    expect(aesEcbPaddedSize(15)).toBe(16);
    expect(aesEcbPaddedSize(16)).toBe(32);  // 满块需额外 16 bytes padding
    expect(aesEcbPaddedSize(17)).toBe(32);
    expect(aesEcbPaddedSize(100)).toBe(112);
  });
});

describe('parseAesKeyFromItem', () => {
  it('IMAGE: 应从 hex aeskey 解析', () => {
    const hexKey = 'a'.repeat(32); // 32 hex chars = 16 bytes
    const item: WeixinMessageItem = {
      type: 2, // IMAGE
      image_item: { aeskey: hexKey },
    };
    const key = parseAesKeyFromItem(item);
    expect(key).not.toBeNull();
    expect(key!.length).toBe(16);
  });

  it('IMAGE: fallback 到 media.aes_key (base64)', () => {
    const rawKey = crypto.randomBytes(16);
    const item: WeixinMessageItem = {
      type: 2,
      image_item: { media: { aes_key: rawKey.toString('base64') } },
    };
    const key = parseAesKeyFromItem(item);
    expect(key).not.toBeNull();
    expect(key!.equals(rawKey)).toBe(true);
  });

  it('VOICE: 应从 media.aes_key (base64) 解析', () => {
    const rawKey = crypto.randomBytes(16);
    const item: WeixinMessageItem = {
      type: 3, // VOICE
      voice_item: { media: { aes_key: rawKey.toString('base64') } },
    };
    const key = parseAesKeyFromItem(item);
    expect(key).not.toBeNull();
    expect(key!.equals(rawKey)).toBe(true);
  });

  it('FILE: 应从 media.aes_key (base64) 解析', () => {
    const rawKey = crypto.randomBytes(16);
    const item: WeixinMessageItem = {
      type: 4, // FILE
      file_item: { media: { aes_key: rawKey.toString('base64') } },
    };
    const key = parseAesKeyFromItem(item);
    expect(key!.equals(rawKey)).toBe(true);
  });

  it('无 key 时应返回 null', () => {
    const item: WeixinMessageItem = { type: 2, image_item: {} };
    expect(parseAesKeyFromItem(item)).toBeNull();
  });
});

describe('getEncryptQueryParam', () => {
  it('应从各类型消息项中提取 encrypt_query_param', () => {
    expect(getEncryptQueryParam({
      type: 2, image_item: { media: { encrypt_query_param: 'img-param' } },
    })).toBe('img-param');

    expect(getEncryptQueryParam({
      type: 3, voice_item: { media: { encrypt_query_param: 'voice-param' } },
    })).toBe('voice-param');

    expect(getEncryptQueryParam({
      type: 4, file_item: { media: { encrypt_query_param: 'file-param' } },
    })).toBe('file-param');

    expect(getEncryptQueryParam({
      type: 5, video_item: { media: { encrypt_query_param: 'video-param' } },
    })).toBe('video-param');
  });

  it('TEXT 类型应返回 undefined', () => {
    expect(getEncryptQueryParam({ type: 1, text_item: { text: 'hi' } })).toBeUndefined();
  });
});
