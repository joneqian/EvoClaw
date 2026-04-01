/**
 * SSE 解析器测试
 *
 * 覆盖:
 * - Anthropic SSE 格式 (event: + data:)
 * - OpenAI SSE 格式 (仅 data:)
 * - [DONE] 终止标记
 * - partial chunk (跨 chunk 的行)
 * - 空行、注释行、空 data
 * - 大量事件流
 */

import { describe, it, expect } from 'vitest';
import { parseSSE, safeParseJSON } from '../../agent/kernel/stream-parser.js';

// ─── Helper: 将字符串转为 ReadableStream ───

function stringToStream(text: string, chunkSize?: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  if (!chunkSize) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  // 模拟网络 chunk 分片
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

async function collectEvents(stream: ReadableStream<Uint8Array>) {
  const events: Array<{ event?: string; data: string }> = [];
  for await (const event of parseSSE(stream)) {
    events.push(event);
  }
  return events;
}

// ═══════════════════════════════════════════════════════════════════════════
// Anthropic SSE Format
// ═══════════════════════════════════════════════════════════════════════════

describe('parseSSE - Anthropic format', () => {
  it('should parse event: + data: pairs', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_01"}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      event: 'message_start',
      data: '{"type":"message_start","message":{"id":"msg_01"}}',
    });
    expect(events[1]).toEqual({
      event: 'content_block_start',
      data: '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    });
  });

  it('should parse full Anthropic streaming sequence', async () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"role":"assistant","usage":{"input_tokens":100}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(7);
    expect(events[0]!.event).toBe('message_start');
    expect(events[2]!.event).toBe('content_block_delta');
    expect(events[5]!.event).toBe('message_delta');
    expect(events[6]!.event).toBe('message_stop');
  });

  it('should handle tool_use content blocks', async () => {
    const sse = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_123","name":"read"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file\\":\\"test.ts\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":1}',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(3);
    expect(events[0]!.event).toBe('content_block_start');
    const block = safeParseJSON<Record<string, unknown>>(events[0]!.data);
    expect((block?.content_block as Record<string, unknown>)?.type).toBe('tool_use');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OpenAI SSE Format
// ═══════════════════════════════════════════════════════════════════════════

describe('parseSSE - OpenAI format', () => {
  it('should parse data-only SSE (no event: line)', async () => {
    const sse = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBeUndefined();
    expect(events[0]!.data).toContain('"Hello"');
    expect(events[1]!.data).toContain('" world"');
  });

  it('should handle [DONE] terminator', async () => {
    const sse = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}',
      '',
      'data: [DONE]',
      '',
      // 这些不应该被处理
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"AFTER_DONE"}}]}',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toContain('"Hi"');
  });

  it('should handle tool_calls in OpenAI format', async () => {
    const sse = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":""}}]}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file\\":\\"test.ts\\"}"}}]}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"tool_calls"}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('parseSSE - edge cases', () => {
  it('should handle partial chunks (line split across chunks)', async () => {
    // 将一行 data 分成多个 chunk
    const sse = 'data: {"text":"hello"}\n\ndata: {"text":"world"}\n\n';
    const stream = stringToStream(sse, 10); // 10 bytes per chunk

    const events = await collectEvents(stream);

    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe('{"text":"hello"}');
    expect(events[1]!.data).toBe('{"text":"world"}');
  });

  it('should skip comment lines', async () => {
    const sse = [
      ': this is a comment',
      'data: {"value":1}',
      '',
      ': another comment',
      'data: {"value":2}',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(2);
  });

  it('should handle empty data lines', async () => {
    const sse = [
      'data: ',
      '',
      'data: {"value":1}',
      '',
    ].join('\n');

    const events = await collectEvents(stringToStream(sse));

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toBe('{"value":1}');
  });

  it('should handle empty stream', async () => {
    const events = await collectEvents(stringToStream(''));
    expect(events).toHaveLength(0);
  });

  it('should handle stream with only whitespace', async () => {
    const events = await collectEvents(stringToStream('\n\n\n'));
    expect(events).toHaveLength(0);
  });

  it('should handle many events efficiently', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`data: {"index":${i}}`);
      lines.push('');
    }
    lines.push('data: [DONE]');
    lines.push('');

    const events = await collectEvents(stringToStream(lines.join('\n')));

    expect(events).toHaveLength(1000);
    expect(safeParseJSON<{ index: number }>(events[0]!.data)?.index).toBe(0);
    expect(safeParseJSON<{ index: number }>(events[999]!.data)?.index).toBe(999);
  });

  it('should handle data without trailing newline', async () => {
    const sse = 'data: {"value":1}';
    const events = await collectEvents(stringToStream(sse));

    // 流结束时 buffer 中有数据也应该处理
    expect(events).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// safeParseJSON
// ═══════════════════════════════════════════════════════════════════════════

describe('safeParseJSON', () => {
  it('should parse valid JSON', () => {
    expect(safeParseJSON('{"key":"value"}')).toEqual({ key: 'value' });
    expect(safeParseJSON('[1,2,3]')).toEqual([1, 2, 3]);
    expect(safeParseJSON('"hello"')).toBe('hello');
    expect(safeParseJSON('42')).toBe(42);
  });

  it('should return null for invalid JSON', () => {
    expect(safeParseJSON('')).toBeNull();
    expect(safeParseJSON('not json')).toBeNull();
    expect(safeParseJSON('{broken')).toBeNull();
    expect(safeParseJSON(undefined as unknown as string)).toBeNull();
  });
});
