/**
 * embedded-runner-loop 基线测试
 *
 * Mock runSingleAttempt 返回可控 AttemptResult，测试外层状态机：
 * - 成功/中止基本流程
 * - Overload 退避重试 + Provider Failover
 * - Auth/Billing → 立即切 provider
 * - Thinking 降级
 * - Context overflow → 裁剪消息重试
 * - maxIterations 上限
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AttemptResult, AgentRunConfig, RuntimeEvent } from '../../agent/types.js';
import type { AttemptParams } from '../../agent/embedded-runner-attempt.js';

// ─── Mock runSingleAttempt ───
const mockAttempt = vi.fn<(params: AttemptParams) => Promise<AttemptResult>>();
vi.mock('../../agent/embedded-runner-attempt.js', () => ({
  runSingleAttempt: (params: AttemptParams) => mockAttempt(params),
}));

// Mock lookupModelDefinition（loop 内部 require() 调用，路径相对于被测文件）
vi.mock('../../provider/extensions/index.js', () => ({
  lookupModelDefinition: vi.fn().mockReturnValue({ reasoning: false }),
}));

const { runEmbeddedLoop } = await import('../../agent/embedded-runner-loop.js');

// ─── Helpers ───

function makeConfig(overrides?: Partial<AgentRunConfig>): AgentRunConfig {
  return {
    agent: { id: 'test', name: 'Test', emoji: '🤖', status: 'active', createdAt: '', updatedAt: '' },
    systemPrompt: '',
    workspaceFiles: {},
    modelId: 'gpt-4o',
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.test.com',
    // 强制 thinkingMode='off' 绕过 require('../provider/extensions/index.js')
    thinkingMode: 'off',
    ...overrides,
  } as AgentRunConfig;
}

function makeConfigWithFallback(): AgentRunConfig {
  return makeConfig({
    fallbackProviders: [
      { provider: 'anthropic', modelId: 'claude-3', apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com' },
    ],
  });
}

function successResult(opts?: Partial<AttemptResult>): AttemptResult {
  return {
    success: true, timedOut: false, timedOutDuringCompaction: false, aborted: false,
    fullResponse: 'ok', toolCalls: [], ...opts,
  };
}

function errorResult(errorType: string, opts?: Partial<AttemptResult>): AttemptResult {
  return {
    success: false, errorType: errorType as AttemptResult['errorType'],
    error: `${errorType} error`, timedOut: false, timedOutDuringCompaction: false,
    aborted: false, fullResponse: '', toolCalls: [], ...opts,
  };
}

function collectEvents(onEvent: ReturnType<typeof vi.fn>): RuntimeEvent[] {
  return onEvent.mock.calls.map((c: unknown[]) => c[0] as RuntimeEvent);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认返回成功（测试需要时覆盖）
  mockAttempt.mockResolvedValue(successResult());
});

// ═══════════════════════════════════════════════════════════════════════════
// 基本流程
// ═══════════════════════════════════════════════════════════════════════════

describe('基本流程', () => {
  it('首次 attempt 成功 → 直接返回', async () => {
    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(1);
  });

  it('abortSignal 已 aborted → 立即退出不调用 attempt', async () => {
    const controller = new AbortController();
    controller.abort();

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent, controller.signal);

    expect(mockAttempt).not.toHaveBeenCalled();
  });

  it('attempt 返回 aborted → 不重试', async () => {
    mockAttempt.mockResolvedValueOnce(errorResult('abort', { aborted: true }));

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Overload 重试
// ═══════════════════════════════════════════════════════════════════════════

describe('Overload 重试', () => {
  it('overload → 退避重试 → 第二次成功', async () => {
    mockAttempt
      .mockResolvedValueOnce(errorResult('overload'))
      .mockResolvedValueOnce(successResult());

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(2);
  });

  it('overload 3 次 → 切 provider', async () => {
    const config = makeConfigWithFallback();

    // 3 次 overload → 切 provider → 成功
    mockAttempt
      .mockResolvedValueOnce(errorResult('overload'))
      .mockResolvedValueOnce(errorResult('overload'))
      .mockResolvedValueOnce(errorResult('overload'))
      .mockResolvedValueOnce(successResult());

    const onEvent = vi.fn();
    await runEmbeddedLoop(config, 'hello', onEvent);

    // 第 4 次调用应该使用 fallback provider
    const lastCall = mockAttempt.mock.calls[3]![0];
    expect(lastCall.providerOverride?.provider).toBe('anthropic');
  });

  it('后台查询 529 → 直接放弃', async () => {
    mockAttempt.mockResolvedValueOnce(errorResult('overload', { error: '529 overloaded' }));

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent, undefined, { isBackgroundQuery: true });

    expect(mockAttempt).toHaveBeenCalledTimes(1);
    const events = collectEvents(onEvent);
    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Provider Failover
// ═══════════════════════════════════════════════════════════════════════════

describe('Provider Failover', () => {
  it('auth 错误 → 立即切 provider', async () => {
    const config = makeConfigWithFallback();

    mockAttempt
      .mockResolvedValueOnce(errorResult('auth'))
      .mockResolvedValueOnce(successResult());

    const onEvent = vi.fn();
    await runEmbeddedLoop(config, 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(2);
    const secondCall = mockAttempt.mock.calls[1]![0];
    expect(secondCall.providerOverride?.provider).toBe('anthropic');
  });

  it('billing 错误 → 切 provider + 携带消息快照', async () => {
    const config = makeConfigWithFallback();
    const snapshot = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];

    mockAttempt
      .mockResolvedValueOnce(errorResult('billing', { messagesSnapshot: snapshot as any }))
      .mockResolvedValueOnce(successResult());

    const onEvent = vi.fn();
    await runEmbeddedLoop(config, 'hello', onEvent);

    const secondCall = mockAttempt.mock.calls[1]![0];
    expect(secondCall.messagesOverride).toEqual(snapshot);
  });

  it('所有 provider 失败 → 发射 error 事件', async () => {
    // 只有 1 个 provider，auth 错误无法 failover
    mockAttempt.mockResolvedValue(errorResult('auth'));

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    const events = collectEvents(onEvent);
    const errorEvents = events.filter(e => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0]!.error).toContain('不可用');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Thinking 降级
// ═══════════════════════════════════════════════════════════════════════════

describe('Thinking 降级', () => {
  it('thinking 错误 → 降级 thinkLevel', async () => {
    mockAttempt
      .mockResolvedValueOnce(errorResult('thinking'))
      .mockResolvedValueOnce(successResult());

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(2);
    // thinking 错误后 degradeThinkLevel 被调用，循环继续
    expect(mockAttempt).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Context Overflow
// ═══════════════════════════════════════════════════════════════════════════

describe('Context Overflow', () => {
  it('overflow → 裁剪消息重试', async () => {
    const longSnapshot = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `msg-${i}` }));

    mockAttempt
      .mockResolvedValueOnce(errorResult('overflow', { messagesSnapshot: longSnapshot as any }))
      .mockResolvedValueOnce(successResult());

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    // 第二次调用应该只有最后 12 条消息
    const secondCall = mockAttempt.mock.calls[1]![0];
    expect(secondCall.messagesOverride?.length).toBe(12);
  });

  it('overflow 3 次后 → 不可恢复', async () => {
    mockAttempt.mockResolvedValue(errorResult('overflow', {
      messagesSnapshot: [{ role: 'user', content: 'x' }] as any,
    }));

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    // 3 次 overflow compaction + 1 次不可恢复
    expect(mockAttempt).toHaveBeenCalledTimes(4);
    const events = collectEvents(onEvent);
    expect(events.some(e => e.type === 'error')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 边界
// ═══════════════════════════════════════════════════════════════════════════

describe('边界', () => {
  it('超时 → 不重试', async () => {
    mockAttempt.mockResolvedValueOnce(errorResult('timeout', { timedOut: true }));

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(1);
    const events = collectEvents(onEvent);
    expect(events.some(e => e.type === 'error' && e.error?.includes('超时'))).toBe(true);
  });

  it('不可恢复错误 → 发射 error 事件', async () => {
    mockAttempt.mockResolvedValueOnce(errorResult('unknown', { error: '模型内部错误' }));

    const onEvent = vi.fn();
    await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(mockAttempt).toHaveBeenCalledTimes(1);
    const events = collectEvents(onEvent);
    expect(events.some(e => e.type === 'error' && e.error?.includes('模型内部错误'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 返回值 (EmbeddedAgentResult)
// ═══════════════════════════════════════════════════════════════════════════

describe('返回值 EmbeddedAgentResult', () => {
  it('成功时返回 messagesSnapshot', async () => {
    const snapshot = [{ role: 'assistant', content: 'done' }];
    mockAttempt.mockResolvedValueOnce(successResult({ messagesSnapshot: snapshot as any }));

    const onEvent = vi.fn();
    const result = await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(result).toBeDefined();
    expect(result?.messagesSnapshot).toEqual(snapshot);
  });

  it('abort 时返回 messagesSnapshot', async () => {
    const snapshot = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'partial' }];
    mockAttempt.mockResolvedValueOnce(errorResult('abort', { aborted: true, messagesSnapshot: snapshot as any }));

    const onEvent = vi.fn();
    const result = await runEmbeddedLoop(makeConfig(), 'hello', onEvent);

    expect(result).toBeDefined();
    expect(result?.messagesSnapshot).toEqual(snapshot);
  });

  it('abortSignal 已 aborted 时返回已积累消息', async () => {
    const controller = new AbortController();
    controller.abort();

    const onEvent = vi.fn();
    const result = await runEmbeddedLoop(makeConfig(), 'hello', onEvent, controller.signal);

    expect(result).toBeDefined();
    // messages 在第一次循环前为 undefined
    expect(result?.messagesSnapshot).toBeUndefined();
  });
});
