/**
 * embedded-runner-attempt 基线测试
 *
 * 策略: Mock queryLoop + 所有重依赖，只测 runSingleAttempt 的控制流：
 * - apiKey 检查
 * - abort 信号处理 + messagesSnapshot 保留
 * - 错误分类
 * - smartTimeout + finally 清理
 *
 * 注意: attempt 有大量 dynamic import，mock 需要覆盖完整。
 * 如果 mock 不稳定，优先保证 abort + messagesSnapshot 测试通过。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentRunConfig } from '../../agent/types.js';
import { AbortError } from '../../agent/kernel/types.js';

// ─── Mock 所有重依赖 ───

const mockQueryLoop = vi.fn();
vi.mock('../../agent/kernel/query-loop.js', () => ({
  queryLoop: (...args: unknown[]) => mockQueryLoop(...args),
}));

vi.mock('../../agent/kernel/tool-adapter.js', () => ({
  buildKernelTools: vi.fn().mockReturnValue([]),
}));

vi.mock('../../agent/embedded-runner-prompt.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  buildSystemPromptBlocks: vi.fn().mockReturnValue([]),
  buildUserContextReminder: vi.fn().mockReturnValue(''),
  SAFETY_CONSTITUTION: '',
}));

vi.mock('../../provider/extensions/index.js', () => ({
  lookupModelDefinition: vi.fn().mockReturnValue({ reasoning: false, contextWindow: 128000, maxTokens: 8192 }),
}));

const mockClassifyError = vi.fn().mockReturnValue({ type: 'unknown', message: 'unknown error' });
const mockIsAbortError = vi.fn().mockReturnValue(false);
vi.mock('../../agent/embedded-runner-errors.js', () => ({
  classifyError: (...args: unknown[]) => mockClassifyError(...args),
  isAbortError: (...args: unknown[]) => mockIsAbortError(...args),
}));

const mockSmartTimeout = { clear: vi.fn(), timedOut: false, timedOutDuringCompaction: false };
vi.mock('../../agent/embedded-runner-timeout.js', () => ({
  createSmartTimeout: vi.fn().mockReturnValue(mockSmartTimeout),
}));

vi.mock('../../agent/memory-flush.js', () => ({
  shouldTriggerFlush: vi.fn().mockReturnValue(false),
  buildMemoryFlushPrompt: vi.fn(),
  createFlushPermissionInterceptor: vi.fn(),
}));

vi.mock('../../agent/kernel/context-compactor.js', () => ({
  resetCompactorState: vi.fn(),
}));

vi.mock('../../agent/tool-safety.js', () => ({
  // vitest 4: vi.fn() 不再默认 constructable，改用 class 表达可 new 的 mock
  ToolSafetyGuard: class MockToolSafetyGuard {},
}));

vi.mock('../../skill/skill-tool.js', () => ({
  createSkillTool: vi.fn().mockReturnValue({
    name: 'invoke_skill',
    description: 'mock',
    inputSchema: { type: 'object', properties: {} },
    call: vi.fn(),
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  }),
}));

vi.mock('../../agent/kernel/tool-search.js', () => ({
  createToolSearchTool: vi.fn().mockReturnValue({
    name: 'tool_search',
    description: 'mock',
    inputSchema: { type: 'object', properties: {} },
    call: vi.fn(),
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  }),
}));

vi.mock('../../context/plugins/tool-registry.js', () => ({
  BUNDLED_SKILLS_DIR: '/tmp/bundled-skills',
}));

vi.mock('../../agent/kernel/runtime-state-store.js', () => ({
  loadRuntimeState: vi.fn().mockReturnValue(null),
  saveRuntimeState: vi.fn(),
}));

vi.mock('../../agent/kernel/incremental-persister.js', () => ({
  IncrementalPersister: class MockIncrementalPersister {
    finalize = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('../../cost/tool-use-summary.js', () => ({
  ToolUseSummaryGenerator: vi.fn(),
}));

// 导入被测模块（所有 mock 已就位）
const { runSingleAttempt } = await import('../../agent/embedded-runner-attempt.js');

// ─── Helpers ───

function makeConfig(overrides?: Partial<AgentRunConfig>): AgentRunConfig {
  return {
    agent: { id: 'test', name: 'Test', emoji: '🤖', status: 'active', createdAt: '', updatedAt: '' },
    systemPrompt: 'test prompt',
    workspaceFiles: {},
    modelId: 'gpt-4o',
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.test.com',
    ...overrides,
  };
}

function makeParams(overrides?: Record<string, unknown>) {
  return {
    config: makeConfig(),
    thinkLevel: 'off' as const,
    message: 'hello',
    onEvent: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSmartTimeout.timedOut = false;
  mockSmartTimeout.timedOutDuringCompaction = false;
  mockSmartTimeout.clear.mockClear();
  mockClassifyError.mockReturnValue({ type: 'unknown', message: 'unknown error' });
  mockIsAbortError.mockReturnValue(false);

  // queryLoop 默认成功完成
  mockQueryLoop.mockResolvedValue({
    fullResponse: 'response',
    toolCalls: [],
    messages: [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'response' }] },
    ],
    totalInputTokens: 100,
    totalOutputTokens: 50,
    exitReason: 'completed',
    turnCount: 1,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 基本流程
// ═══════════════════════════════════════════════════════════════════════════

describe('基本流程', () => {
  it('无 apiKey → 返回 auth 错误', async () => {
    const result = await runSingleAttempt(makeParams({
      config: makeConfig({ apiKey: '' }),
    }));

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('auth');
    expect(result.error).toContain('API key');
    expect(mockQueryLoop).not.toHaveBeenCalled();
  });

  it('queryLoop 正常完成 → success=true', async () => {
    const result = await runSingleAttempt(makeParams());

    expect(result.success).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.messagesSnapshot).toBeDefined();
    expect(result.messagesSnapshot!.length).toBeGreaterThan(0);
  });

  it('fullResponse 通过 onEvent text_delta 累积', async () => {
    const onEvent = vi.fn();

    // queryLoop 调用 wrappedOnEvent 时会被截获
    mockQueryLoop.mockImplementation(async (config: any) => {
      // 模拟 queryLoop 内部发射事件
      config.onEvent({ type: 'text_delta', delta: 'hello ', timestamp: Date.now() });
      config.onEvent({ type: 'text_delta', delta: 'world', timestamp: Date.now() });
      return {
        fullResponse: 'hello world',
        toolCalls: [],
        messages: [{ id: '1', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        totalInputTokens: 10,
        totalOutputTokens: 5,
        exitReason: 'completed',
        turnCount: 1,
      };
    });

    const result = await runSingleAttempt(makeParams({ onEvent }));
    expect(result.success).toBe(true);
    // onEvent 应该收到 text_delta 事件
    const textEvents = onEvent.mock.calls.filter((c: any) => c[0]?.type === 'text_delta');
    expect(textEvents.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Abort 处理
// ═══════════════════════════════════════════════════════════════════════════

describe('Abort 处理', () => {
  it('abortSignal aborted → 返回 aborted=true', async () => {
    const controller = new AbortController();

    mockQueryLoop.mockImplementation(async () => {
      controller.abort(); // 在执行中中止
      throw new Error('aborted');
    });

    const result = await runSingleAttempt(makeParams({
      abortSignal: controller.signal,
    }));

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.errorType).toBe('abort');
  });

  it('AbortError 异常 → 返回 aborted=true', async () => {
    mockQueryLoop.mockRejectedValue(new AbortError('cancelled'));

    const result = await runSingleAttempt(makeParams());

    expect(result.success).toBe(false);
    expect(result.aborted).toBe(true);
  });

  it('abort 时 messagesSnapshot 仍然返回', async () => {
    const controller = new AbortController();

    mockQueryLoop.mockImplementation(async () => {
      controller.abort();
      throw new Error('aborted');
    });

    const result = await runSingleAttempt(makeParams({
      abortSignal: controller.signal,
    }));

    expect(result.aborted).toBe(true);
    // 关键: messagesSnapshot 在 catch 块中通过 kernelMessages.map 生成
    // 即使 abort 也应该有值（至少包含用户消息）
    expect(result.messagesSnapshot).toBeDefined();
    expect(result.messagesSnapshot!.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 错误分类
// ═══════════════════════════════════════════════════════════════════════════

describe('错误分类', () => {
  it('非 abort 错误 → 通过 classifyError 分类', async () => {
    mockClassifyError.mockReturnValue({ type: 'overflow', message: '413 too large' });
    mockQueryLoop.mockRejectedValue(new Error('413'));

    const result = await runSingleAttempt(makeParams());

    expect(result.success).toBe(false);
    expect(result.errorType).toBe('overflow');
    expect(result.error).toBe('413 too large');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 超时
// ═══════════════════════════════════════════════════════════════════════════

describe('超时', () => {
  it('smartTimeout 触发 → timedOut=true', async () => {
    mockSmartTimeout.timedOut = true;
    mockQueryLoop.mockRejectedValue(new Error('timeout'));

    const result = await runSingleAttempt(makeParams());

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('超时时 messagesSnapshot 仍然返回', async () => {
    mockSmartTimeout.timedOut = true;
    mockQueryLoop.mockRejectedValue(new Error('timeout'));

    const result = await runSingleAttempt(makeParams());

    expect(result.timedOut).toBe(true);
    expect(result.messagesSnapshot).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Finally 清理
// ═══════════════════════════════════════════════════════════════════════════

describe('Finally 清理', () => {
  it('成功时 smartTimeout.clear 被调用', async () => {
    await runSingleAttempt(makeParams());
    expect(mockSmartTimeout.clear).toHaveBeenCalled();
  });

  it('错误时 smartTimeout.clear 仍被调用', async () => {
    mockQueryLoop.mockRejectedValue(new Error('fail'));
    await runSingleAttempt(makeParams());
    expect(mockSmartTimeout.clear).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// lastKnownMessages 修复验证
// ═══════════════════════════════════════════════════════════════════════════

describe('lastKnownMessages (catch 块消息修复)', () => {
  it('queryLoop 正常返回后 catch 块使用 kernel 积累的消息', async () => {
    // queryLoop 正常返回（abort 在轮次间检测到）包含 assistant 消息
    const accumulatedMessages = [
      { id: '1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'thinking...' }] },
      { id: '3', role: 'user', content: [{ type: 'text', text: 'continue' }] },
      { id: '4', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    mockQueryLoop.mockResolvedValue({
      fullResponse: 'done',
      toolCalls: [],
      messages: accumulatedMessages,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      exitReason: 'abort',
      turnCount: 2,
    });

    const result = await runSingleAttempt(makeParams());

    // 即使 exitReason='abort'，queryLoop 正常 resolve → try 块执行
    // messagesSnapshot 应包含 kernel 积累的所有消息
    expect(result.messagesSnapshot).toBeDefined();
    expect(result.messagesSnapshot!.length).toBe(4);
    expect(result.messagesSnapshot![1]!.content).toContain('thinking');
  });
});
