/**
 * 流式客户端测试
 *
 * 覆盖:
 * - ToolCallAccumulator: 增量 JSON 拼接
 * - buildAnthropicRequest: 请求体构建
 * - buildOpenAIRequest: 请求体构建
 * - processAnthropicStream: SSE → StreamEvent 归一化
 * - processOpenAIStream: SSE → StreamEvent 归一化
 * - serializeMessageForOpenAI: KernelMessage → OpenAI messages
 * - IdleWatchdog: 超时行为
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _testing } from '../../agent/kernel/stream-client.js';
import type { StreamEvent, KernelMessage, KernelTool } from '../../agent/kernel/types.js';

const {
  ToolCallAccumulator,
  buildAnthropicRequest,
  buildOpenAIRequest,
  processAnthropicStream,
  processOpenAIStream,
  serializeMessageForOpenAI,
  createIdleWatchdog,
} = _testing;

// ─── Helper ───

function stringToStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeSSE(lines: string[]): ReadableStream<Uint8Array> {
  return stringToStream(lines.join('\n') + '\n');
}

async function collectStreamEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

function noopWatchdog() {
  return createIdleWatchdog(999_999, () => {});
}

function mockTool(name: string, opts?: { readOnly?: boolean; concurrent?: boolean }): KernelTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    call: async () => ({ content: 'ok' }),
    isReadOnly: () => opts?.readOnly ?? false,
    isConcurrencySafe: () => opts?.concurrent ?? false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ToolCallAccumulator
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolCallAccumulator', () => {
  it('should accumulate a single tool call', () => {
    const acc = new ToolCallAccumulator();

    // 第一个 chunk: 开始新 tool call
    const started = acc.feed({ index: 0, id: 'call_1', function: { name: 'read', arguments: '' } });
    expect(started).toEqual({ started: true, index: 0, id: 'call_1', name: 'read' });

    // 后续 chunk: 累积参数
    acc.feed({ index: 0, function: { arguments: '{"fi' } });
    acc.feed({ index: 0, function: { arguments: 'le":"test.ts"}' } });

    const results = acc.flush();
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'call_1',
      name: 'read',
      input: { file: 'test.ts' },
    });
  });

  it('should accumulate multiple concurrent tool calls', () => {
    const acc = new ToolCallAccumulator();

    acc.feed({ index: 0, id: 'call_1', function: { name: 'read', arguments: '' } });
    acc.feed({ index: 1, id: 'call_2', function: { name: 'grep', arguments: '' } });

    acc.feed({ index: 0, function: { arguments: '{"file":"a.ts"}' } });
    acc.feed({ index: 1, function: { arguments: '{"pattern":"TODO"}' } });

    const results = acc.flush();
    expect(results).toHaveLength(2);
    expect(results[0]!.name).toBe('read');
    expect(results[0]!.input).toEqual({ file: 'a.ts' });
    expect(results[1]!.name).toBe('grep');
    expect(results[1]!.input).toEqual({ pattern: 'TODO' });
  });

  it('should handle empty arguments', () => {
    const acc = new ToolCallAccumulator();
    acc.feed({ index: 0, id: 'call_1', function: { name: 'ls', arguments: '' } });

    const results = acc.flush();
    expect(results[0]!.input).toEqual({});
  });

  it('should handle malformed JSON arguments', () => {
    const acc = new ToolCallAccumulator();
    acc.feed({ index: 0, id: 'call_1', function: { name: 'read', arguments: '{broken' } });

    const results = acc.flush();
    expect(results[0]!.input).toEqual({});
  });

  it('should return null for subsequent deltas (not started)', () => {
    const acc = new ToolCallAccumulator();
    acc.feed({ index: 0, id: 'call_1', function: { name: 'read', arguments: '' } });

    const result = acc.feed({ index: 0, function: { arguments: '{}' } });
    expect(result).toBeNull();
  });

  it('should clear after flush', () => {
    const acc = new ToolCallAccumulator();
    acc.feed({ index: 0, id: 'call_1', function: { name: 'read', arguments: '{}' } });
    acc.flush();

    expect(acc.size).toBe(0);
    expect(acc.flush()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildAnthropicRequest
// ═══════════════════════════════════════════════════════════════════════════

describe('buildAnthropicRequest', () => {
  const baseConfig = {
    protocol: 'anthropic-messages' as const,
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-test',
    modelId: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are helpful.',
    messages: [] as KernelMessage[],
    tools: [] as KernelTool[],
    maxTokens: 4096,
    thinkingConfig: { type: 'disabled' } as const,
  };

  it('should build correct URL with /v1 auto-append', () => {
    const spec = buildAnthropicRequest(baseConfig);
    expect(spec.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('should not double-append /v1', () => {
    const spec = buildAnthropicRequest({ ...baseConfig, baseUrl: 'https://api.anthropic.com/v1' });
    expect(spec.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('should set x-api-key header', () => {
    const spec = buildAnthropicRequest(baseConfig);
    expect(spec.headers['x-api-key']).toBe('sk-test');
  });

  it('should include stream: true', () => {
    const spec = buildAnthropicRequest(baseConfig);
    expect(spec.body.stream).toBe(true);
  });

  it('should include tools when present', () => {
    const tools = [mockTool('read')];
    const spec = buildAnthropicRequest({ ...baseConfig, tools });
    expect(spec.body.tools).toBeDefined();
    expect((spec.body.tools as unknown[])).toHaveLength(1);
  });

  it('should omit tools when empty', () => {
    const spec = buildAnthropicRequest(baseConfig);
    expect(spec.body.tools).toBeUndefined();
  });

  it('should include thinking config when enabled (fixed budget)', () => {
    const spec = buildAnthropicRequest({ ...baseConfig, thinkingConfig: { type: 'enabled' } });
    const thinking = spec.body.thinking as Record<string, unknown>;
    expect(thinking.type).toBe('enabled');
    expect(thinking.budget_tokens).toBeGreaterThan(0);
  });

  it('should include adaptive thinking config', () => {
    const spec = buildAnthropicRequest({ ...baseConfig, thinkingConfig: { type: 'adaptive' } });
    const thinking = spec.body.thinking as Record<string, unknown>;
    expect(thinking.type).toBe('adaptive');
  });

  it('should not include thinking when disabled', () => {
    const spec = buildAnthropicRequest({ ...baseConfig, thinkingConfig: { type: 'disabled' } });
    expect(spec.body.thinking).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildOpenAIRequest
// ═══════════════════════════════════════════════════════════════════════════

describe('buildOpenAIRequest', () => {
  const baseConfig = {
    protocol: 'openai-completions' as const,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    modelId: 'gpt-4o',
    systemPrompt: 'You are helpful.',
    messages: [] as KernelMessage[],
    tools: [] as KernelTool[],
    maxTokens: 4096,
    thinkingConfig: { type: 'disabled' } as const,
  };

  it('should build correct URL', () => {
    const spec = buildOpenAIRequest(baseConfig);
    expect(spec.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('should set Bearer auth header', () => {
    const spec = buildOpenAIRequest(baseConfig);
    expect(spec.headers['Authorization']).toBe('Bearer sk-test');
  });

  it('should include system message first', () => {
    const spec = buildOpenAIRequest(baseConfig);
    const messages = spec.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('should include stream_options', () => {
    const spec = buildOpenAIRequest(baseConfig);
    expect(spec.body.stream_options).toEqual({ include_usage: true });
  });

  it('should convert tools to function format', () => {
    const tools = [mockTool('read')];
    const spec = buildOpenAIRequest({ ...baseConfig, tools });
    const apiTools = spec.body.tools as Array<Record<string, unknown>>;
    expect(apiTools[0]!.type).toBe('function');
    expect((apiTools[0]!.function as Record<string, unknown>).name).toBe('read');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// serializeMessageForOpenAI
// ═══════════════════════════════════════════════════════════════════════════

describe('serializeMessageForOpenAI', () => {
  it('should serialize user text message', () => {
    const msg: KernelMessage = {
      id: '1', role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
    };
    const result = serializeMessageForOpenAI(msg);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('should serialize assistant message with tool_calls', () => {
    const msg: KernelMessage = {
      id: '1', role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read that.' },
        { type: 'tool_use', id: 'call_1', name: 'read', input: { file: 'test.ts' } },
      ],
    };
    const result = serializeMessageForOpenAI(msg);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('assistant');
    expect(result[0]!.content).toBe('Let me read that.');
    expect((result[0]!.tool_calls as unknown[])).toHaveLength(1);
  });

  it('should serialize tool_result as role:tool messages', () => {
    const msg: KernelMessage = {
      id: '1', role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'file content here' },
      ],
    };
    const result = serializeMessageForOpenAI(msg);
    expect(result).toEqual([{
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'file content here',
    }]);
  });

  it('should handle mixed text + tool_result in user message', () => {
    const msg: KernelMessage = {
      id: '1', role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'result1' },
        { type: 'tool_result', tool_use_id: 'call_2', content: 'result2' },
      ],
    };
    const result = serializeMessageForOpenAI(msg);
    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe('tool');
    expect(result[1]!.role).toBe('tool');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// processAnthropicStream
// ═══════════════════════════════════════════════════════════════════════════

describe('processAnthropicStream', () => {
  it('should process text streaming sequence', async () => {
    const sse = makeSSE([
      'event: message_start',
      'data: {"type":"message_start","message":{"role":"assistant","usage":{"input_tokens":50,"output_tokens":0}}}',
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
    ]);

    const events = await collectStreamEvents(processAnthropicStream(sse, noopWatchdog()));

    // usage + text_delta(2) + usage + done
    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { delta: string }).delta).toBe('Hello');
    expect((textDeltas[1] as { delta: string }).delta).toBe(' world');

    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0] as { stopReason: string }).stopReason).toBe('end_turn');
  });

  it('should process tool_use streaming', async () => {
    const sse = makeSSE([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"read"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"file\\""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":":\\"test.ts\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ]);

    const events = await collectStreamEvents(processAnthropicStream(sse, noopWatchdog()));

    const toolStart = events.find(e => e.type === 'tool_use_start');
    expect(toolStart).toEqual({ type: 'tool_use_start', id: 'call_1', name: 'read' });

    const toolEnd = events.find(e => e.type === 'tool_use_end') as { input: Record<string, unknown> };
    expect(toolEnd.input).toEqual({ file: 'test.ts' });
  });

  it('should process thinking blocks', async () => {
    const sse = makeSSE([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ]);

    const events = await collectStreamEvents(processAnthropicStream(sse, noopWatchdog()));

    const thinkingDeltas = events.filter(e => e.type === 'thinking_delta');
    expect(thinkingDeltas).toHaveLength(1);
    expect((thinkingDeltas[0] as { delta: string }).delta).toBe('Let me think...');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// processOpenAIStream
// ═══════════════════════════════════════════════════════════════════════════

describe('processOpenAIStream', () => {
  it('should process text streaming', async () => {
    const sse = makeSSE([
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ]);

    const events = await collectStreamEvents(processOpenAIStream(sse, noopWatchdog()));

    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as { delta: string }).delta).toBe('Hello');

    const doneEvents = events.filter(e => e.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0] as { stopReason: string }).stopReason).toBe('stop');
  });

  it('should process tool_calls with delta accumulation', async () => {
    const sse = makeSSE([
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":""}}]}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file\\""}}]}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"test.ts\\"}"}}]}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"tool_calls"}]}',
      '',
      'data: [DONE]',
      '',
    ]);

    const events = await collectStreamEvents(processOpenAIStream(sse, noopWatchdog()));

    const toolStarts = events.filter(e => e.type === 'tool_use_start');
    expect(toolStarts).toHaveLength(1);
    expect((toolStarts[0] as { name: string }).name).toBe('read');

    const toolEnds = events.filter(e => e.type === 'tool_use_end');
    expect(toolEnds).toHaveLength(1);
    expect((toolEnds[0] as { input: Record<string, unknown> }).input).toEqual({ file: 'test.ts' });
  });

  it('should handle usage in stream', async () => {
    const sse = makeSSE([
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ]);

    const events = await collectStreamEvents(processOpenAIStream(sse, noopWatchdog()));

    const usageEvents = events.filter(e => e.type === 'usage');
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0] as { usage: { inputTokens: number } }).usage.inputTokens).toBe(10);
  });

  it('should handle reasoning_content (DeepSeek etc.)', async () => {
    const sse = makeSSE([
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"thinking..."}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"answer"}}]}',
      '',
      'data: {"id":"chatcmpl-1","choices":[{"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
    ]);

    const events = await collectStreamEvents(processOpenAIStream(sse, noopWatchdog()));

    const thinkingDeltas = events.filter(e => e.type === 'thinking_delta');
    expect(thinkingDeltas).toHaveLength(1);
    expect((thinkingDeltas[0] as { delta: string }).delta).toBe('thinking...');

    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// IdleWatchdog
// ═══════════════════════════════════════════════════════════════════════════

describe('IdleWatchdog', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('should call onTimeout after timeout', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(watchdog.aborted).toBe(true);
  });

  it('should reset timer on each reset() call', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    vi.advanceTimersByTime(500);
    watchdog.reset(); // 重置
    vi.advanceTimersByTime(500);
    expect(onTimeout).not.toHaveBeenCalled(); // 还没到 1000ms

    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('should not fire after clear()', () => {
    const onTimeout = vi.fn();
    const watchdog = createIdleWatchdog(1000, onTimeout);

    watchdog.reset();
    vi.advanceTimersByTime(500);
    watchdog.clear();
    vi.advanceTimersByTime(2000);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(watchdog.aborted).toBe(false);
  });
});
