import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryExtractPlugin } from '../context/plugins/memory-extract.js';
import type { MemoryExtractor } from '../memory/memory-extractor.js';
import type { TurnContext } from '../context/plugin.interface.js';

function createMockExtractor(result = { memoryIds: ['m1'], relationCount: 1, skipped: false }) {
  return {
    extractAndPersist: vi.fn().mockResolvedValue(result),
  } as unknown as MemoryExtractor;
}

function createMockContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    agentId: 'agent-1',
    sessionKey: 'agent:agent-1:default:dm:user-1',
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮你的？' },
    ],
    systemPrompt: '',
    injectedContext: [],
    estimatedTokens: 100,
    tokenLimit: 100000,
    warnings: [],
    ...overrides,
  } as TurnContext;
}

describe('记忆提取互斥 + 游标追踪', () => {
  let extractor: ReturnType<typeof createMockExtractor>;

  beforeEach(() => {
    extractor = createMockExtractor();
  });

  it('正常情况下调用提取器', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);
    await plugin.afterTurn!(createMockContext());
    expect(extractor.extractAndPersist).toHaveBeenCalledOnce();
  });

  it('注入检测时跳过提取', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);
    const ctx = createMockContext({
      securityFlags: { injectionDetected: true, injectionSeverity: 'high' } as TurnContext['securityFlags'],
    });
    await plugin.afterTurn!(ctx);
    expect(extractor.extractAndPersist).not.toHaveBeenCalled();
  });

  it('低级注入不跳过', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);
    const ctx = createMockContext({
      securityFlags: { injectionDetected: true, injectionSeverity: 'low' } as TurnContext['securityFlags'],
    });
    await plugin.afterTurn!(ctx);
    expect(extractor.extractAndPersist).toHaveBeenCalledOnce();
  });

  it('同一消息 ID 不重复提取', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);

    const msgs = [
      { role: 'user' as const, content: '你好', id: 'msg-1' },
      { role: 'assistant' as const, content: '你好！', id: 'msg-2' },
    ];
    const ctx1 = createMockContext({ messages: msgs as TurnContext['messages'] });
    const ctx2 = createMockContext({ messages: msgs as TurnContext['messages'] });

    await plugin.afterTurn!(ctx1);
    await plugin.afterTurn!(ctx2);

    // 第二次应被游标跳过
    expect(extractor.extractAndPersist).toHaveBeenCalledOnce();
  });

  it('不同消息 ID 正常提取', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);

    const msgs1 = [
      { role: 'user' as const, content: '你好', id: 'msg-1' },
      { role: 'assistant' as const, content: '你好！', id: 'msg-2' },
    ];
    const msgs2 = [
      { role: 'user' as const, content: '再见', id: 'msg-3' },
      { role: 'assistant' as const, content: '再见！', id: 'msg-4' },
    ];

    await plugin.afterTurn!(createMockContext({ messages: msgs1 as TurnContext['messages'] }));
    await plugin.afterTurn!(createMockContext({ messages: msgs2 as TurnContext['messages'] }));

    expect(extractor.extractAndPersist).toHaveBeenCalledTimes(2);
  });

  it('Agent 使用记忆工具后跳过提取', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);

    const msgs = [
      { role: 'user' as const, content: '你记得我的偏好吗？' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool_use', name: 'memory_search', id: 'tu-1', input: { query: '偏好' } },
        ],
      },
      { role: 'assistant' as const, content: '根据记忆，你喜欢简洁风格。' },
    ];

    await plugin.afterTurn!(createMockContext({ messages: msgs as TurnContext['messages'] }));
    expect(extractor.extractAndPersist).not.toHaveBeenCalled();
  });

  it('Agent 使用非记忆工具不影响提取', async () => {
    const plugin = createMemoryExtractPlugin(extractor as unknown as MemoryExtractor);

    const msgs = [
      { role: 'user' as const, content: '查一下文件' },
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool_use', name: 'read_file', id: 'tu-1', input: { path: '/test.ts' } },
        ],
      },
      { role: 'assistant' as const, content: '文件内容如下...' },
    ];

    await plugin.afterTurn!(createMockContext({ messages: msgs as TurnContext['messages'] }));
    expect(extractor.extractAndPersist).toHaveBeenCalledOnce();
  });

  it('提取失败后 inProgress 重置', async () => {
    const failExtractor = {
      extractAndPersist: vi.fn().mockRejectedValueOnce(new Error('LLM 失败')).mockResolvedValue({ memoryIds: ['m1'], relationCount: 0, skipped: false }),
    } as unknown as MemoryExtractor;

    const plugin = createMemoryExtractPlugin(failExtractor);

    // 第一次失败
    await plugin.afterTurn!(createMockContext());
    // 第二次应该可以正常执行（inProgress 已重置）
    const msgs2 = [
      { role: 'user' as const, content: '新消息', id: 'msg-new' },
      { role: 'assistant' as const, content: '回复', id: 'msg-new-2' },
    ];
    await plugin.afterTurn!(createMockContext({ messages: msgs2 as TurnContext['messages'] }));

    expect(failExtractor.extractAndPersist).toHaveBeenCalledTimes(2);
  });
});
