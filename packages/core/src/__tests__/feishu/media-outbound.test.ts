/**
 * PR2 Phase D 测试：媒体上传 / 下载 / 出站发送
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  inferFileType,
  isImageFile,
  resourceTypeFor,
  uploadImage,
  uploadFile,
  downloadMessageResource,
  cleanupMediaCache,
} from '../../channel/adapters/feishu/media.js';
import {
  inferReceiveIdType,
  sendTextMessage,
  sendPostMessage,
  sendSmartMessage,
  sendImageMessage,
  sendFileMessage,
  sendMediaMessage,
} from '../../channel/adapters/feishu/outbound.js';

// ─── MIME / 类型推断 ──────────────────────────────────────────────────────

describe('inferFileType', () => {
  it('图片走 stream（file.create 不支持 image，最终应用走 image.create）', () => {
    // 注：inferFileType 主要给 file.create 用；图片不会传到这里
    expect(inferFileType('a.png')).toBe('stream');
  });

  it('音频扩展名返回 opus', () => {
    expect(inferFileType('voice.m4a')).toBe('opus');
    expect(inferFileType('voice.mp3')).toBe('opus');
    expect(inferFileType('voice.opus')).toBe('opus');
  });

  it('视频扩展名返回 mp4', () => {
    expect(inferFileType('v.mp4')).toBe('mp4');
    expect(inferFileType('v.mov')).toBe('mp4');
  });

  it('Office 文档', () => {
    expect(inferFileType('a.pdf')).toBe('pdf');
    expect(inferFileType('a.doc')).toBe('doc');
    expect(inferFileType('a.xlsx')).toBe('xls');
    expect(inferFileType('a.pptx')).toBe('ppt');
  });

  it('未知扩展名 fallback stream', () => {
    expect(inferFileType('a.bin')).toBe('stream');
    expect(inferFileType('no-ext')).toBe('stream');
  });
});

describe('isImageFile', () => {
  it('常见图片扩展名', () => {
    expect(isImageFile('a.jpg')).toBe(true);
    expect(isImageFile('a.JPEG')).toBe(true);
    expect(isImageFile('a.png')).toBe(true);
    expect(isImageFile('a.gif')).toBe(true);
    expect(isImageFile('a.webp')).toBe(true);
  });

  it('非图片', () => {
    expect(isImageFile('a.pdf')).toBe(false);
    expect(isImageFile('a.mp4')).toBe(false);
  });
});

describe('resourceTypeFor', () => {
  it('image 返回 image', () => {
    expect(resourceTypeFor('image')).toBe('image');
  });
  it('非 image 返回 file', () => {
    expect(resourceTypeFor('file')).toBe('file');
    expect(resourceTypeFor('audio')).toBe('file');
    expect(resourceTypeFor('media')).toBe('file');
    expect(resourceTypeFor('sticker')).toBe('file');
  });
});

// ─── 上传 / 下载 ────────────────────────────────────────────────────────

describe('uploadImage / uploadFile', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `feishu-test-${Date.now()}.bin`);
    await fs.writeFile(tmpFile, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG 魔数
  });

  afterEach(async () => {
    try {
      await fs.unlink(tmpFile);
    } catch {}
  });

  it('uploadImage 调用 im.v1.image.create 并返回 key', async () => {
    const client = {
      im: {
        v1: {
          image: {
            create: vi.fn().mockResolvedValue({ image_key: 'img_abc' }),
          },
        },
      },
    } as any;

    const key = await uploadImage(client, tmpFile);
    expect(key).toBe('img_abc');
    expect(client.im.v1.image.create).toHaveBeenCalledWith({
      data: { image_type: 'message', image: expect.any(Buffer) },
    });
  });

  it('uploadImage 未返回 image_key 时抛错', async () => {
    const client = {
      im: { v1: { image: { create: vi.fn().mockResolvedValue({}) } } },
    } as any;

    await expect(uploadImage(client, tmpFile)).rejects.toThrow(/image_key/);
  });

  it('uploadFile 根据扩展名推断 file_type', async () => {
    const client = {
      im: {
        v1: {
          file: {
            create: vi.fn().mockResolvedValue({ file_key: 'file_xyz' }),
          },
        },
      },
    } as any;

    const pdfPath = tmpFile.replace(/\.bin$/, '.pdf');
    await fs.rename(tmpFile, pdfPath);
    tmpFile = pdfPath;

    const key = await uploadFile(client, pdfPath);
    expect(key).toBe('file_xyz');
    expect(client.im.v1.file.create).toHaveBeenCalledWith({
      data: {
        file_type: 'pdf',
        file_name: path.basename(pdfPath),
        file: expect.any(Buffer),
      },
    });
  });

  it('uploadFile 支持 duration 可选字段', async () => {
    const client = {
      im: {
        v1: {
          file: {
            create: vi.fn().mockResolvedValue({ file_key: 'file_v' }),
          },
        },
      },
    } as any;
    await uploadFile(client, tmpFile, { duration: 1200 });
    const call = client.im.v1.file.create.mock.calls[0][0];
    expect(call.data.duration).toBe(1200);
  });
});

describe('downloadMessageResource', () => {
  it('写入到临时目录并返回 MIME', async () => {
    const cacheDir = path.join(os.tmpdir(), `feishu-dl-test-${Date.now()}`);
    const writeFile = vi.fn(async (p: string) => {
      await fs.writeFile(p, 'fake');
    });
    const client = {
      im: {
        v1: {
          messageResource: {
            get: vi.fn().mockResolvedValue({
              writeFile,
              getReadableStream: () => null,
              headers: { 'content-type': 'image/png; charset=utf-8' },
            }),
          },
        },
      },
    } as any;

    const result = await downloadMessageResource(client, {
      messageId: 'om_1',
      fileKey: 'img_xyz',
      msgType: 'image',
      cacheDir,
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.path.startsWith(cacheDir)).toBe(true);
    expect(writeFile).toHaveBeenCalled();
    await cleanupMediaCache(cacheDir);
  });

  it('MIME 缺失时返回 null', async () => {
    const cacheDir = path.join(os.tmpdir(), `feishu-dl-nomime-${Date.now()}`);
    const writeFile = vi.fn(async (p: string) => {
      await fs.writeFile(p, '');
    });
    const client = {
      im: {
        v1: {
          messageResource: {
            get: vi.fn().mockResolvedValue({
              writeFile,
              getReadableStream: () => null,
              headers: {},
            }),
          },
        },
      },
    } as any;

    const r = await downloadMessageResource(client, {
      messageId: 'om_1',
      fileKey: 'file_x',
      msgType: 'file',
      cacheDir,
    });
    expect(r.mimeType).toBeNull();
    await cleanupMediaCache(cacheDir);
  });
});

// ─── 出站发送 ────────────────────────────────────────────────────────────

function createMockMessageClient() {
  return {
    im: {
      v1: {
        message: {
          create: vi.fn().mockResolvedValue({ code: 0 }),
        },
        image: {
          create: vi.fn().mockResolvedValue({ image_key: 'img_k' }),
        },
        file: {
          create: vi.fn().mockResolvedValue({ file_key: 'file_k' }),
        },
      },
    },
  };
}

describe('outbound 各发送方法', () => {
  it('sendTextMessage 使用 msg_type=text', async () => {
    const client = createMockMessageClient();
    await sendTextMessage(client as any, 'ou_x', '你好', 'private');
    const call = client.im.v1.message.create.mock.calls[0][0];
    expect(call.params.receive_id_type).toBe('open_id');
    expect(call.data.msg_type).toBe('text');
    expect(JSON.parse(call.data.content)).toEqual({ text: '你好' });
  });

  it('sendPostMessage 使用 msg_type=post', async () => {
    const client = createMockMessageClient();
    const postJson = JSON.stringify({ zh_cn: { content: [] } });
    await sendPostMessage(client as any, 'oc_x', postJson, 'group');
    const call = client.im.v1.message.create.mock.calls[0][0];
    expect(call.params.receive_id_type).toBe('chat_id');
    expect(call.data.msg_type).toBe('post');
    expect(call.data.content).toBe(postJson);
  });

  it('sendSmartMessage 纯文本走 text', async () => {
    const client = createMockMessageClient();
    await sendSmartMessage(client as any, 'ou_x', '普通文本', 'private');
    const call = client.im.v1.message.create.mock.calls[0][0];
    expect(call.data.msg_type).toBe('text');
  });

  it('sendSmartMessage Markdown 走 post', async () => {
    const client = createMockMessageClient();
    await sendSmartMessage(client as any, 'ou_x', '**加粗**文本', 'private');
    const call = client.im.v1.message.create.mock.calls[0][0];
    expect(call.data.msg_type).toBe('post');
  });

  it('sendSmartMessage Post 失败应降级纯文本重试', async () => {
    const client = createMockMessageClient();
    // 第一次（post）返回错误，第二次（text）成功
    client.im.v1.message.create
      .mockResolvedValueOnce({ code: 230001, msg: 'bad post' })
      .mockResolvedValueOnce({ code: 0 });

    await sendSmartMessage(client as any, 'ou_x', '**加粗**', 'private');
    expect(client.im.v1.message.create).toHaveBeenCalledTimes(2);
    const secondCall = client.im.v1.message.create.mock.calls[1][0];
    expect(secondCall.data.msg_type).toBe('text');
  });

  it('sendImageMessage 先上传后发送 image_key', async () => {
    const client = createMockMessageClient();
    const tmpPath = path.join(os.tmpdir(), `test-${Date.now()}.png`);
    await fs.writeFile(tmpPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    try {
      await sendImageMessage(client as any, 'ou_x', tmpPath, 'private');
      expect(client.im.v1.image.create).toHaveBeenCalled();
      const msgCall = client.im.v1.message.create.mock.calls[0][0];
      expect(msgCall.data.msg_type).toBe('image');
      expect(JSON.parse(msgCall.data.content)).toEqual({ image_key: 'img_k' });
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  it('sendFileMessage 先上传后发送 file_key', async () => {
    const client = createMockMessageClient();
    const tmpPath = path.join(os.tmpdir(), `test-${Date.now()}.pdf`);
    await fs.writeFile(tmpPath, Buffer.from('fake pdf'));
    try {
      await sendFileMessage(client as any, 'ou_x', tmpPath, 'private');
      expect(client.im.v1.file.create).toHaveBeenCalled();
      const msgCall = client.im.v1.message.create.mock.calls[0][0];
      expect(msgCall.data.msg_type).toBe('file');
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  });

  it('sendMediaMessage 根据扩展名分派', async () => {
    const client = createMockMessageClient();
    const img = path.join(os.tmpdir(), `test-${Date.now()}.png`);
    const doc = path.join(os.tmpdir(), `test-${Date.now()}.pdf`);
    await fs.writeFile(img, Buffer.from([0x89]));
    await fs.writeFile(doc, Buffer.from('pdf'));
    try {
      await sendMediaMessage(client as any, 'ou', img);
      expect(client.im.v1.image.create).toHaveBeenCalled();
      await sendMediaMessage(client as any, 'ou', doc);
      expect(client.im.v1.file.create).toHaveBeenCalled();
    } finally {
      await fs.unlink(img).catch(() => {});
      await fs.unlink(doc).catch(() => {});
    }
  });

  it('inferReceiveIdType 旧接口仍能工作', () => {
    expect(inferReceiveIdType('group')).toBe('chat_id');
    expect(inferReceiveIdType('private')).toBe('open_id');
  });
});
