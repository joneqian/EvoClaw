/**
 * SILK 语音格式转码
 *
 * 微信语音消息使用 SILK 编码格式，需要转码为 WAV 才能送入 ASR。
 * 依赖 silk-wasm (可选)，不可用时返回 null。
 */

import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('weixin-silk');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** SILK 格式魔术字节 */
const SILK_MAGIC = Buffer.from('#!SILK');
/** 带前缀的 SILK 魔术字节 (微信常用) */
const SILK_MAGIC_PREFIXED = Buffer.from('\x02#!SILK');

/** 默认采样率 (Hz) — 微信语音标准 */
const DEFAULT_SAMPLE_RATE = 24_000;

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 检测 buffer 是否为 SILK 格式
 *
 * SILK 文件以 `#!SILK` 或 `\x02#!SILK` 开头
 */
export function isSilkFormat(buffer: Buffer): boolean {
  if (buffer.length < SILK_MAGIC.length) return false;

  // 检查带前缀的版本
  if (buffer.length >= SILK_MAGIC_PREFIXED.length) {
    if (buffer.subarray(0, SILK_MAGIC_PREFIXED.length).equals(SILK_MAGIC_PREFIXED)) {
      return true;
    }
  }

  // 检查标准版本
  return buffer.subarray(0, SILK_MAGIC.length).equals(SILK_MAGIC);
}

/**
 * 将 SILK 音频转码为 WAV 格式
 *
 * 动态导入 silk-wasm，不可用时返回 null。
 * WAV 格式: mono, 16-bit signed LE, 24000Hz
 *
 * @param silkBuffer - SILK 编码的音频数据
 * @returns WAV Buffer，失败或 silk-wasm 不可用时返回 null
 */
export async function silkToWav(silkBuffer: Buffer): Promise<Buffer | null> {
  try {
    const { decode } = await import('silk-wasm');

    log.debug(`SILK 解码开始: ${silkBuffer.length} bytes`);
    const result = await decode(silkBuffer, DEFAULT_SAMPLE_RATE);
    log.debug(`SILK 解码完成: duration=${result.duration}ms, pcmBytes=${result.data.byteLength}`);

    const wav = buildWavBuffer(result.data, DEFAULT_SAMPLE_RATE);
    log.debug(`WAV 生成完成: ${wav.length} bytes`);
    return wav;
  } catch (err) {
    log.warn(`SILK 转码失败，将使用原始音频: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// WAV 构建
// ---------------------------------------------------------------------------

/**
 * 构建标准 44 字节 WAV/RIFF 文件头
 *
 * @param pcmLength - PCM 数据字节长度
 * @param sampleRate - 采样率 (Hz)
 * @param channels - 声道数
 * @param bitsPerSample - 每样本位数
 * @returns 44 字节的 WAV 文件头 Buffer
 */
export function buildWavHeader(
  pcmLength: number,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const totalSize = 44 + pcmLength;

  const header = Buffer.allocUnsafe(44);
  let offset = 0;

  // RIFF chunk
  header.write('RIFF', offset); offset += 4;
  header.writeUInt32LE(totalSize - 8, offset); offset += 4;
  header.write('WAVE', offset); offset += 4;

  // fmt sub-chunk
  header.write('fmt ', offset); offset += 4;
  header.writeUInt32LE(16, offset); offset += 4;          // fmt chunk size
  header.writeUInt16LE(1, offset); offset += 2;           // PCM format
  header.writeUInt16LE(channels, offset); offset += 2;    // 声道数
  header.writeUInt32LE(sampleRate, offset); offset += 4;  // 采样率
  header.writeUInt32LE(byteRate, offset); offset += 4;    // 字节率
  header.writeUInt16LE(blockAlign, offset); offset += 2;  // 块对齐
  header.writeUInt16LE(bitsPerSample, offset); offset += 2; // 位深度

  // data sub-chunk
  header.write('data', offset); offset += 4;
  header.writeUInt32LE(pcmLength, offset);

  return header;
}

/**
 * 将 PCM 数据包装为完整的 WAV Buffer
 * 默认: mono, 16-bit, 指定采样率
 */
function buildWavBuffer(pcmData: Uint8Array, sampleRate: number): Buffer {
  const pcmBytes = pcmData.byteLength;
  const header = buildWavHeader(pcmBytes, sampleRate, 1, 16);
  const wav = Buffer.allocUnsafe(44 + pcmBytes);
  header.copy(wav, 0);
  Buffer.from(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength).copy(wav, 44);
  return wav;
}
