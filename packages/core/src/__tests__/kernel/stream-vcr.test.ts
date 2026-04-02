/**
 * Stream VCR 录制/回放测试
 */

import { describe, it, expect } from 'vitest';
import type { StreamEvent } from '../../agent/kernel/types.js';
import { recordStream, replayStream } from '../../agent/kernel/stream-vcr.js';
import type { VCRCassette } from '../../agent/kernel/stream-vcr.js';

// ─── Helpers ───

async function* fakeStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) {
    yield e;
  }
}

async function collectAll(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const result: StreamEvent[] = [];
  for await (const e of gen) {
    result.push(e);
  }
  return result;
}

describe('Stream VCR', () => {
  const sampleEvents: StreamEvent[] = [
    { type: 'text_delta', delta: 'Hello ' },
    { type: 'text_delta', delta: 'World' },
    { type: 'tool_use_start', id: 't1', name: 'read' },
    { type: 'tool_use_end', id: 't1', name: 'read', input: { path: '/test' } },
    { type: 'done', stopReason: 'end_turn' },
  ];

  describe('recordStream', () => {
    it('应透传所有事件', async () => {
      const { stream } = recordStream(
        fakeStream(sampleEvents),
        { protocol: 'anthropic-messages', modelId: 'test-model' },
      );
      const collected = await collectAll(stream);
      expect(collected).toEqual(sampleEvents);
    });

    it('getCassette 应包含所有录制的事件', async () => {
      const { stream, getCassette } = recordStream(
        fakeStream(sampleEvents),
        { protocol: 'anthropic-messages', modelId: 'claude-3' },
      );
      await collectAll(stream);

      const cassette = getCassette();
      expect(cassette.eventCount).toBe(5);
      expect(cassette.protocol).toBe('anthropic-messages');
      expect(cassette.modelId).toBe('claude-3');
      expect(cassette.recordedAt).toBeTruthy();
      expect(cassette.events).toHaveLength(5);
    });

    it('每个条目应有递增的 elapsedMs', async () => {
      const { stream, getCassette } = recordStream(
        fakeStream(sampleEvents),
        { protocol: 'openai-completions', modelId: 'gpt-4' },
      );
      await collectAll(stream);

      const cassette = getCassette();
      for (let i = 1; i < cassette.events.length; i++) {
        expect(cassette.events[i].elapsedMs).toBeGreaterThanOrEqual(
          cassette.events[i - 1].elapsedMs,
        );
      }
    });

    it('空流应返回空 cassette', async () => {
      const { stream, getCassette } = recordStream(
        fakeStream([]),
        { protocol: 'anthropic-messages', modelId: 'test' },
      );
      await collectAll(stream);

      const cassette = getCassette();
      expect(cassette.eventCount).toBe(0);
      expect(cassette.events).toHaveLength(0);
      expect(cassette.durationMs).toBe(0);
    });
  });

  describe('replayStream', () => {
    it('应按序回放所有事件', async () => {
      const cassette: VCRCassette = {
        protocol: 'anthropic-messages',
        modelId: 'test',
        events: sampleEvents.map((event, i) => ({ event, elapsedMs: i * 10 })),
        recordedAt: new Date().toISOString(),
        eventCount: sampleEvents.length,
        durationMs: 40,
      };

      const replayed = await collectAll(replayStream(cassette));
      expect(replayed).toEqual(sampleEvents);
    });

    it('空 cassette 应返回空流', async () => {
      const cassette: VCRCassette = {
        protocol: 'anthropic-messages',
        modelId: 'test',
        events: [],
        recordedAt: new Date().toISOString(),
        eventCount: 0,
        durationMs: 0,
      };

      const replayed = await collectAll(replayStream(cassette));
      expect(replayed).toHaveLength(0);
    });

    it('realtime=false 应即时回放（不延迟）', async () => {
      const cassette: VCRCassette = {
        protocol: 'anthropic-messages',
        modelId: 'test',
        events: [
          { event: { type: 'text_delta', delta: 'a' }, elapsedMs: 0 },
          { event: { type: 'text_delta', delta: 'b' }, elapsedMs: 10_000 }, // 10s gap
        ],
        recordedAt: new Date().toISOString(),
        eventCount: 2,
        durationMs: 10_000,
      };

      const start = Date.now();
      await collectAll(replayStream(cassette, false));
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100); // 应该几乎即时
    });
  });

  describe('录制+回放往返', () => {
    it('回放结果应与原始事件相同', async () => {
      // 录制
      const { stream, getCassette } = recordStream(
        fakeStream(sampleEvents),
        { protocol: 'anthropic-messages', modelId: 'test' },
      );
      await collectAll(stream);
      const cassette = getCassette();

      // 回放
      const replayed = await collectAll(replayStream(cassette));
      expect(replayed).toEqual(sampleEvents);
    });
  });
});
