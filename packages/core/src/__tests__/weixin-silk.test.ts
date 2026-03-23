import { describe, it, expect, vi } from 'vitest';

import { isSilkFormat, silkToWav, buildWavHeader } from '../channel/adapters/weixin-silk.js';

// Mock logger
vi.mock('../infrastructure/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('weixin-silk', () => {
  // -----------------------------------------------------------------------
  // isSilkFormat
  // -----------------------------------------------------------------------

  describe('isSilkFormat', () => {
    it('应识别标准 SILK 魔术字节 (#!SILK)', () => {
      const buf = Buffer.from('#!SILK_V3some_audio_data');
      expect(isSilkFormat(buf)).toBe(true);
    });

    it('应识别带前缀的 SILK 魔术字节 (\\x02#!SILK)', () => {
      const buf = Buffer.concat([
        Buffer.from([0x02]),
        Buffer.from('#!SILK_V3some_audio_data'),
      ]);
      expect(isSilkFormat(buf)).toBe(true);
    });

    it('非 SILK 数据应返回 false', () => {
      const buf = Buffer.from('RIFF....WAVEfmt ');
      expect(isSilkFormat(buf)).toBe(false);
    });

    it('空 buffer 应返回 false', () => {
      expect(isSilkFormat(Buffer.alloc(0))).toBe(false);
    });

    it('太短的 buffer 应返回 false', () => {
      expect(isSilkFormat(Buffer.from('#!'))).toBe(false);
    });

    it('随机二进制数据应返回 false', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(isSilkFormat(buf)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // buildWavHeader
  // -----------------------------------------------------------------------

  describe('buildWavHeader', () => {
    it('应生成 44 字节的标准 WAV 头', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.length).toBe(44);
    });

    it('RIFF 标识应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    });

    it('WAVE 标识应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.toString('ascii', 8, 12)).toBe('WAVE');
    });

    it('fmt 标识应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.toString('ascii', 12, 16)).toBe('fmt ');
    });

    it('data 标识应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.toString('ascii', 36, 40)).toBe('data');
    });

    it('文件总大小应正确 (pcmLength + 44 - 8)', () => {
      const pcmLength = 48000;
      const header = buildWavHeader(pcmLength, 24000, 1, 16);
      // RIFF chunk size = totalSize - 8
      const riffSize = header.readUInt32LE(4);
      expect(riffSize).toBe(pcmLength + 44 - 8);
    });

    it('PCM 格式标识应为 1', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.readUInt16LE(20)).toBe(1);
    });

    it('采样率应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.readUInt32LE(24)).toBe(24000);
    });

    it('声道数应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.readUInt16LE(22)).toBe(1);
    });

    it('位深度应正确', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      expect(header.readUInt16LE(34)).toBe(16);
    });

    it('字节率应正确 (sampleRate * channels * bitsPerSample/8)', () => {
      const header = buildWavHeader(48000, 24000, 1, 16);
      // 24000 * 1 * 2 = 48000
      expect(header.readUInt32LE(28)).toBe(48000);
    });

    it('data chunk size 应等于 pcmLength', () => {
      const pcmLength = 48000;
      const header = buildWavHeader(pcmLength, 24000, 1, 16);
      expect(header.readUInt32LE(40)).toBe(pcmLength);
    });
  });

  // -----------------------------------------------------------------------
  // silkToWav
  // -----------------------------------------------------------------------

  describe('silkToWav', () => {
    it('silk-wasm 不可用时应返回 null', async () => {
      // silk-wasm 未安装，import 会失败
      const silkBuf = Buffer.from('#!SILK_V3fake_data');
      const result = await silkToWav(silkBuf);
      expect(result).toBeNull();
    });
  });
});
