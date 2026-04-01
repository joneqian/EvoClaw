/**
 * Query Loop 核心测试
 *
 * 通过 mock streamLLM 测试:
 * - 单轮对话 (无工具调用 → 正常退出)
 * - 多轮工具调用循环
 * - maxTurns 限制
 * - abort 中止
 * - 413 overflow 循环内恢复
 * - 工具执行错误不中断循环
 * - RuntimeEvent 事件发射
 * - fullResponse 累积
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StreamEvent, KernelTool, QueryLoopConfig, KernelMessage, ToolCallResult } from '../../agent/kernel/types.js';
import { ApiError, AbortError } from '../../agent/kernel/types.js';
import { ToolSafetyGuard } from '../../agent/tool-safety.js';

// ─── Mock streamLLM ───
// vi.mock 需要在顶层

const mockStreamLLM = vi.fn<[], AsyncGenerator<StreamEvent>>();

vi.mock('../../agent/kernel/stream-client.js', () => ({
  streamLLM: (...args: unknown[]) => mockStreamLLM(...(args as [])),
}));

// Mock maybeCompress (不在单元测试中真正调用 LLM)
vi.mock('../../agent/kernel/context-compactor.js', () => ({
  maybeCompress: vi.fn().mockResolvedValue(false),
}));

// 现在导入被测模块 (mock 已就位)
const { queryLoop } = await import('../../agent/kernel/query-loop.js');

// ─── Helpers ───

/** 创建一个产生指定事件序列的 async generator */
async function* fakeStream(events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const e of events) {
    yield e;
  }
}

/** 简单文本响应 (无工具调用) */
function textResponse(text: string): StreamEvent[] {
  return [
    { type: 'text_delta', delta: text },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'done', stopReason: 'end_turn' },
  ];
}

/** 工具调用响应 */
function toolCallResponse(toolId: string, toolName: string, input: Record<string, unknown>): StreamEvent[] {
  return [
    { type: 'text_delta', delta: `Calling ${toolName}...` },
    { type: 'tool_use_start', id: toolId, name: toolName },
    { type: 'tool_use_end', id: toolId, name: toolName, input },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } },
    { type: 'done', stopReason: 'end_turn' },
  ];
}

function mockTool(name: string, result = 'tool result'): KernelTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    call: vi.fn().mockResolvedValue({ content: result } as ToolCallResult),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

function baseConfig(overrides?: Partial<QueryLoopConfig>): QueryLoopConfig {
  return {
    protocol: 'openai-completions',
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'sk-test',
    modelId: 'test-model',
    maxTokens: 4096,
    contextWindow: 128_000,
    thinking: false,
    tools: [],
    systemPrompt: 'You are helpful.',
    messages: [{
      id: '1', role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
    }],
    maxTurns: 50,
    timeoutMs: 600_000,
    onEvent: vi.fn(),
    toolSafety: new ToolSafetyGuard(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 基本流程
// ═══════════════════════════════════════════════════════════════════════════

describe('queryLoop - basic flow', () => {
  it('should complete single turn with text response', async () => {
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Hello world')));

    const result = await queryLoop(baseConfig());

    expect(result.fullResponse).toBe('Hello world');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.totalInputTokens).toBe(10);
    expect(result.totalOutputTokens).toBe(5);
    expect(result.messages.length).toBeGreaterThan(1); // initial + assistant
  });

  it('should emit text_delta events', async () => {
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Hi')));
    const onEvent = vi.fn();

    await queryLoop(baseConfig({ onEvent }));

    const textDeltas = onEvent.mock.calls.filter(([e]) => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(1);
    expect(textDeltas[0]![0].delta).toBe('Hi');
  });

  it('should emit message_start and message_end events', async () => {
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Hi')));
    const onEvent = vi.fn();

    await queryLoop(baseConfig({ onEvent }));

    const types = onEvent.mock.calls.map(([e]) => e.type);
    expect(types).toContain('message_start');
    expect(types).toContain('message_end');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 工具调用
// ═══════════════════════════════════════════════════════════════════════════

describe('queryLoop - tool calls', () => {
  it('should execute tool and continue for second turn', async () => {
    const readTool = mockTool('read', 'file content');

    // Turn 1: 工具调用
    mockStreamLLM.mockReturnValueOnce(
      fakeStream(toolCallResponse('call_1', 'read', { file: 'test.ts' })),
    );
    // Turn 2: 文本响应 (结束)
    mockStreamLLM.mockReturnValueOnce(
      fakeStream(textResponse('Here is the file content.')),
    );

    const result = await queryLoop(baseConfig({ tools: [readTool] }));

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.toolName).toBe('read');
    expect(result.fullResponse).toContain('Here is the file content.');
    expect(readTool.call).toHaveBeenCalledOnce();
    expect(mockStreamLLM).toHaveBeenCalledTimes(2); // 2 turns
  });

  it('should handle multiple tool calls in one turn', async () => {
    const readTool = mockTool('read', 'content');
    const grepTool = mockTool('grep', 'match');

    // Turn 1: 两个工具
    mockStreamLLM.mockReturnValueOnce(fakeStream([
      { type: 'tool_use_start', id: 'c1', name: 'read' },
      { type: 'tool_use_end', id: 'c1', name: 'read', input: { file: 'a.ts' } },
      { type: 'tool_use_start', id: 'c2', name: 'grep' },
      { type: 'tool_use_end', id: 'c2', name: 'grep', input: { pattern: 'TODO' } },
      { type: 'usage', usage: { inputTokens: 30, outputTokens: 15 } },
      { type: 'done', stopReason: 'end_turn' },
    ]));
    // Turn 2: 结束
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Done.')));

    const result = await queryLoop(baseConfig({ tools: [readTool, grepTool] }));

    expect(result.toolCalls).toHaveLength(2);
    expect(readTool.call).toHaveBeenCalledOnce();
    expect(grepTool.call).toHaveBeenCalledOnce();
  });

  it('should emit tool_end events', async () => {
    const readTool = mockTool('read');
    const onEvent = vi.fn();

    mockStreamLLM.mockReturnValueOnce(
      fakeStream(toolCallResponse('c1', 'read', {})),
    );
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Done.')));

    await queryLoop(baseConfig({ tools: [readTool], onEvent }));

    const toolEnds = onEvent.mock.calls.filter(([e]) => e.type === 'tool_end');
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0]![0].toolName).toBe('read');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 限制与终止
// ═══════════════════════════════════════════════════════════════════════════

describe('queryLoop - limits and termination', () => {
  it('should stop at maxTurns', async () => {
    const readTool = mockTool('read');

    // 每轮都调用工具 → 无限循环
    mockStreamLLM.mockImplementation(() =>
      fakeStream(toolCallResponse('c1', 'read', {})),
    );

    const result = await queryLoop(baseConfig({
      tools: [readTool],
      maxTurns: 3,
    }));

    expect(mockStreamLLM).toHaveBeenCalledTimes(3);
    // 3 turns × 1 tool call = 3
    expect(result.toolCalls).toHaveLength(3);
  });

  it('should throw AbortError when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      queryLoop(baseConfig({ abortSignal: controller.signal })),
    ).rejects.toThrow(AbortError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 错误恢复
// ═══════════════════════════════════════════════════════════════════════════

describe('queryLoop - error recovery', () => {
  it('should retry on 413 overflow after compression', async () => {
    const readTool = mockTool('read');

    // Turn 1: 413 错误
    mockStreamLLM.mockReturnValueOnce((async function* () {
      yield { type: 'error', message: 'prompt too long', status: 413 } as StreamEvent;
    })());

    // Turn 1 retry: 成功
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Recovered!')));

    const result = await queryLoop(baseConfig({ tools: [readTool] }));

    expect(result.fullResponse).toBe('Recovered!');
    expect(mockStreamLLM).toHaveBeenCalledTimes(2);
  });

  it('should propagate non-recoverable errors', async () => {
    // 401 auth error → 不可恢复
    mockStreamLLM.mockReturnValueOnce((async function* () {
      yield { type: 'error', message: 'unauthorized', status: 401 } as StreamEvent;
    })());

    await expect(
      queryLoop(baseConfig()),
    ).rejects.toThrow();
  });

  it('should handle tool execution errors gracefully', async () => {
    const failTool: KernelTool = {
      name: 'fail',
      description: 'always fails',
      inputSchema: {},
      call: vi.fn().mockRejectedValue(new Error('boom')),
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
    };

    mockStreamLLM.mockReturnValueOnce(
      fakeStream(toolCallResponse('c1', 'fail', {})),
    );
    mockStreamLLM.mockReturnValueOnce(fakeStream(textResponse('Handled error.')));

    const result = await queryLoop(baseConfig({ tools: [failTool] }));

    // 工具错误不中断循环，错误作为 tool_result 返回给模型
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.isError).toBe(true);
    expect(result.fullResponse).toContain('Handled error.');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Token 累积
// ═══════════════════════════════════════════════════════════════════════════

describe('queryLoop - token tracking', () => {
  it('should accumulate tokens across turns', async () => {
    const readTool = mockTool('read');

    mockStreamLLM.mockReturnValueOnce(fakeStream([
      ...toolCallResponse('c1', 'read', {}),
    ]));
    mockStreamLLM.mockReturnValueOnce(fakeStream([
      { type: 'text_delta', delta: 'Done' },
      { type: 'usage', usage: { inputTokens: 50, outputTokens: 25 } },
      { type: 'done', stopReason: 'end_turn' },
    ]));

    const result = await queryLoop(baseConfig({ tools: [readTool] }));

    // Turn 1: 20+10, Turn 2: 50+25
    expect(result.totalInputTokens).toBe(70);
    expect(result.totalOutputTokens).toBe(35);
  });
});
