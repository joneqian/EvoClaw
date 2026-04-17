/**
 * M3 T1 测试：Grace Call 收尾摘要
 *
 * 验证 packages/core/src/agent/kernel/grace-call.ts 的行为：
 * - 白名单退出原因才触发
 * - 禁用 / abort / 异常 / error event 均吞错返回 ''
 * - 正常流程拼接前缀标记 `\n\n---\n**本次任务总结:**\n`
 * - 构造的 StreamConfig 正确（空 tools / disabled thinking / maxTokens）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryLoopConfig, LoopState, ExitReason, StreamEvent } from '../../../agent/kernel/types.js';

// ─── Mock streamLLM ───
// 在 import 被测模块前 mock，确保 maybeGraceCall 用到的是 mock 版本
const mockStreamLLM = vi.fn();
vi.mock('../../../agent/kernel/stream-client.js', () => ({
  streamLLM: (cfg: unknown) => mockStreamLLM(cfg),
}));

import {
  maybeGraceCall,
  buildGraceCallStreamConfig,
  buildGraceCallMessage,
  GRACE_CALL_SUMMARY_MARKER,
} from '../../../agent/kernel/grace-call.js';

// ─── 辅助：构造最小 QueryLoopConfig + LoopState ───

function makeConfig(overrides: Partial<QueryLoopConfig> = {}): QueryLoopConfig {
  return {
    protocol: 'anthropic-messages',
    baseUrl: 'https://example.com',
    apiKey: 'test-key',
    modelId: 'test-model',
    maxTokens: 4096,
    contextWindow: 200_000,
    thinkingConfig: { type: 'disabled' },
    tools: [],
    systemPrompt: 'system',
    messages: [],
    maxTurns: 10,
    timeoutMs: 60_000,
    onEvent: () => {},
    toolSafety: {} as QueryLoopConfig['toolSafety'],
    ...overrides,
  };
}

function makeState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    messages: [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我分析数据' }] },
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '好的，我调用工具...' }] },
    ],
    turnCount: 5,
    transition: null,
    overflowRetries: 0,
    maxOutputRecoveryCount: 0,
    effectiveMaxTokens: 4096,
    effectiveModelId: 'test-model',
    ...overrides,
  };
}

/** 构造一个 async generator 产出给定事件序列 */
function makeEventStream(events: readonly StreamEvent[]): AsyncGenerator<StreamEvent> {
  async function* gen(): AsyncGenerator<StreamEvent> {
    for (const e of events) yield e;
  }
  return gen();
}

beforeEach(() => {
  mockStreamLLM.mockReset();
});

// ─── 纯函数测试 ───

describe('buildGraceCallMessage', () => {
  it('根据不同 exitReason 生成不同原因描述', () => {
    const msgA = buildGraceCallMessage('max_turns');
    const msgB = buildGraceCallMessage('token_budget_exhausted');
    const textA = (msgA.content[0] as { type: 'text'; text: string }).text;
    const textB = (msgB.content[0] as { type: 'text'; text: string }).text;
    expect(textA).toContain('最大工具调用轮次');
    expect(textB).toContain('总 Token 预算');
    // 要求中文 + ≤300 字约束
    expect(textA).toContain('不超过 300 字');
    expect(msgA.role).toBe('user');
    expect(msgA.isMeta).toBe(true);
  });
});

describe('buildGraceCallStreamConfig', () => {
  it('返回空 tools + disabled thinking + 注入 meta message', () => {
    const config = makeConfig();
    const state = makeState();
    const streamConfig = buildGraceCallStreamConfig(config, state, 'max_turns', 256);
    expect(streamConfig.tools).toEqual([]);
    expect(streamConfig.thinkingConfig).toEqual({ type: 'disabled' });
    expect(streamConfig.maxTokens).toBe(256);
    expect(streamConfig.messages.length).toBe(state.messages.length + 1);
    expect(streamConfig.messages[streamConfig.messages.length - 1].isMeta).toBe(true);
  });

  it('默认 maxTokens=512', () => {
    const streamConfig = buildGraceCallStreamConfig(makeConfig(), makeState(), 'max_turns');
    expect(streamConfig.maxTokens).toBe(512);
  });
});

// ─── maybeGraceCall 主路径 ───

describe('maybeGraceCall', () => {
  it('不在白名单 exitReason (abort) → 直接返回空字符串，不调 streamLLM', async () => {
    const result = await maybeGraceCall(makeConfig(), makeState(), 'abort' as ExitReason);
    expect(result).toBe('');
    expect(mockStreamLLM).not.toHaveBeenCalled();
  });

  it('graceCall.enabled=false → 跳过，不调 streamLLM', async () => {
    const config = makeConfig({ graceCall: { enabled: false } });
    const result = await maybeGraceCall(config, makeState(), 'max_turns');
    expect(result).toBe('');
    expect(mockStreamLLM).not.toHaveBeenCalled();
  });

  it('abortSignal 已触发 → 跳过', async () => {
    const controller = new AbortController();
    controller.abort();
    const config = makeConfig({ abortSignal: controller.signal });
    const result = await maybeGraceCall(config, makeState(), 'max_turns');
    expect(result).toBe('');
    expect(mockStreamLLM).not.toHaveBeenCalled();
  });

  it('正常摘要流程 → 返回前缀 + 摘要文本', async () => {
    mockStreamLLM.mockReturnValueOnce(makeEventStream([
      { type: 'text_delta', delta: '用户要求分析数据。' },
      { type: 'text_delta', delta: '已完成工具调用 A。' },
      { type: 'text_delta', delta: '未完成 B。建议拆分任务重发。' },
      { type: 'done', stopReason: 'end_turn' },
    ]));

    const result = await maybeGraceCall(makeConfig(), makeState(), 'max_turns');
    expect(result.startsWith(GRACE_CALL_SUMMARY_MARKER)).toBe(true);
    expect(result).toContain('用户要求分析数据');
    expect(result).toContain('未完成 B');
    expect(mockStreamLLM).toHaveBeenCalledTimes(1);
  });

  it('stream 中产生 error event → 返回空字符串', async () => {
    mockStreamLLM.mockReturnValueOnce(makeEventStream([
      { type: 'text_delta', delta: '部分...' },
      { type: 'error', message: 'rate limited', status: 429 },
    ]));
    const result = await maybeGraceCall(makeConfig(), makeState(), 'token_budget_exhausted');
    expect(result).toBe('');
  });

  it('streamLLM 抛异常 → 吞错返回空字符串', async () => {
    mockStreamLLM.mockImplementationOnce(() => {
      throw new Error('network fail');
    });
    const result = await maybeGraceCall(makeConfig(), makeState(), 'max_turns');
    expect(result).toBe('');
  });

  it('摘要全为空白 → 返回空字符串（不拼接空标记）', async () => {
    mockStreamLLM.mockReturnValueOnce(makeEventStream([
      { type: 'text_delta', delta: '   ' },
      { type: 'text_delta', delta: '\n' },
      { type: 'done', stopReason: 'end_turn' },
    ]));
    const result = await maybeGraceCall(makeConfig(), makeState(), 'max_turns');
    expect(result).toBe('');
  });

  it('流结束时 abortSignal 已触发 → 丢弃部分摘要', async () => {
    const controller = new AbortController();
    mockStreamLLM.mockImplementationOnce(() => {
      // 在流开始后触发 abort
      const events: StreamEvent[] = [
        { type: 'text_delta', delta: '还没说完' },
      ];
      async function* gen(): AsyncGenerator<StreamEvent> {
        for (const e of events) {
          yield e;
          controller.abort();
        }
      }
      return gen();
    });
    const config = makeConfig({ abortSignal: controller.signal });
    const result = await maybeGraceCall(config, makeState(), 'max_turns');
    expect(result).toBe('');
  });
});
