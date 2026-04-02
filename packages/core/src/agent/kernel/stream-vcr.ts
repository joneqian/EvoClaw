/**
 * Stream VCR — 流式 SSE 录制与回放
 *
 * 录制真实 API 流式响应的事件序列，用于调试、测试和问题复现。
 *
 * 参考 Claude Code withStreamingVCR() — 包装流式调用支持录制/回放。
 *
 * 使用示例:
 *   // 录制
 *   const { stream, getCassette } = recordStream(streamLLM(config));
 *   for await (const event of stream) { ... }
 *   const cassette = getCassette();
 *   fs.writeFileSync('cassette.json', JSON.stringify(cassette));
 *
 *   // 回放
 *   for await (const event of replayStream(cassette)) { ... }
 */

import type { StreamEvent, ApiProtocol } from './types.js';

/** VCR 磁带 — 录制的事件序列 */
export interface VCRCassette {
  /** 使用的 API 协议 */
  protocol: ApiProtocol;
  /** 模型 ID */
  modelId: string;
  /** 事件序列（带时间戳） */
  events: VCREntry[];
  /** 录制时间 */
  recordedAt: string;
  /** 总事件数 */
  eventCount: number;
  /** 总录制时长 (ms) */
  durationMs: number;
}

export interface VCREntry {
  /** 流式事件 */
  event: StreamEvent;
  /** 相对于录制开始的毫秒数 */
  elapsedMs: number;
}

/**
 * 录制 — 包装 AsyncGenerator，记录每个 yield 的事件
 *
 * 返回一个新的 stream（透传所有事件）和 getCassette() 获取录制结果。
 */
export function recordStream(
  source: AsyncGenerator<StreamEvent>,
  meta: { protocol: ApiProtocol; modelId: string },
): { stream: AsyncGenerator<StreamEvent>; getCassette: () => VCRCassette } {
  const entries: VCREntry[] = [];
  const startTime = Date.now();

  async function* wrappedStream(): AsyncGenerator<StreamEvent> {
    for await (const event of source) {
      entries.push({
        event,
        elapsedMs: Date.now() - startTime,
      });
      yield event;
    }
  }

  function getCassette(): VCRCassette {
    const durationMs = entries.length > 0
      ? entries[entries.length - 1].elapsedMs
      : 0;
    return {
      protocol: meta.protocol,
      modelId: meta.modelId,
      events: entries,
      recordedAt: new Date(startTime).toISOString(),
      eventCount: entries.length,
      durationMs,
    };
  }

  return { stream: wrappedStream(), getCassette };
}

/**
 * 回放 — 从 VCRCassette 播放事件序列
 *
 * @param cassette 录制的磁带
 * @param realtime 是否模拟真实延迟（默认 false = 即时回放）
 */
export async function* replayStream(
  cassette: VCRCassette,
  realtime = false,
): AsyncGenerator<StreamEvent> {
  let lastElapsed = 0;

  for (const entry of cassette.events) {
    if (realtime && entry.elapsedMs > lastElapsed) {
      const delay = entry.elapsedMs - lastElapsed;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    lastElapsed = entry.elapsedMs;
    yield entry.event;
  }
}
