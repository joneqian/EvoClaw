import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextEngine } from '../context/context-engine.js';
import type { ContextPlugin, TurnContext, BootstrapContext, ShutdownContext, CompactContext } from '../context/plugin.interface.js';
import type { ChatMessage, SessionKey } from '@evoclaw/shared';

/** 创建模拟 TurnContext */
function makeTurnContext(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    agentId: 'agent-001',
    sessionKey: 'agent:agent-001:default:direct:user1' as SessionKey,
    messages: [],
    systemPrompt: '你是一个助手',
    injectedContext: [],
    estimatedTokens: 1000,
    tokenLimit: 4000,
    ...overrides,
  };
}

/** 创建模拟 BootstrapContext */
function makeBootstrapContext(): BootstrapContext {
  return {
    agentId: 'agent-001',
    sessionKey: 'agent:agent-001:default:direct:user1' as SessionKey,
    workspacePath: '/tmp/test',
  };
}

/** 创建模拟 ShutdownContext */
function makeShutdownContext(): ShutdownContext {
  return {
    agentId: 'agent-001',
    sessionKey: 'agent:agent-001:default:direct:user1' as SessionKey,
  };
}

/** 创建模拟消息 */
function makeMessage(content: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    conversationId: 'conv-001',
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

/** 创建一个带全部钩子的模拟插件 */
function createMockPlugin(name: string, priority: number): ContextPlugin & {
  bootstrap: ReturnType<typeof vi.fn>;
  beforeTurn: ReturnType<typeof vi.fn>;
  afterTurn: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
} {
  return {
    name,
    priority,
    bootstrap: vi.fn().mockResolvedValue(undefined),
    beforeTurn: vi.fn().mockResolvedValue(undefined),
    afterTurn: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    compact: vi.fn().mockImplementation(async (ctx: CompactContext) => ctx.messages),
  };
}

describe('ContextEngine', () => {
  let engine: ContextEngine;

  beforeEach(() => {
    engine = new ContextEngine();
  });

  // ---------- register ----------

  describe('register', () => {
    it('注册后应按 priority 排序（数值越小越靠前）', () => {
      const pluginA = createMockPlugin('A', 10);
      const pluginB = createMockPlugin('B', 1);
      const pluginC = createMockPlugin('C', 5);

      engine.register(pluginA);
      engine.register(pluginB);
      engine.register(pluginC);

      const plugins = engine.getPlugins();
      expect(plugins).toHaveLength(3);
      // 按 priority 升序: B(1) → C(5) → A(10)
      expect(plugins[0].name).toBe('B');
      expect(plugins[1].name).toBe('C');
      expect(plugins[2].name).toBe('A');
    });
  });

  // ---------- unregister ----------

  describe('unregister', () => {
    it('应按名称移除插件', () => {
      const pluginA = createMockPlugin('A', 1);
      const pluginB = createMockPlugin('B', 2);

      engine.register(pluginA);
      engine.register(pluginB);
      engine.unregister('A');

      const plugins = engine.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('B');
    });

    it('移除不存在的插件不应报错', () => {
      engine.register(createMockPlugin('X', 1));
      engine.unregister('不存在的插件');
      expect(engine.getPlugins()).toHaveLength(1);
    });
  });

  // ---------- bootstrap ----------

  describe('bootstrap', () => {
    it('应按 priority 顺序串行调用插件', async () => {
      const callOrder: string[] = [];
      const pluginA = createMockPlugin('A', 10);
      pluginA.bootstrap.mockImplementation(async () => { callOrder.push('A'); });
      const pluginB = createMockPlugin('B', 1);
      pluginB.bootstrap.mockImplementation(async () => { callOrder.push('B'); });

      engine.register(pluginA);
      engine.register(pluginB);

      const ctx = makeBootstrapContext();
      await engine.bootstrap(ctx);

      // B(priority=1) 应先于 A(priority=10)
      expect(callOrder).toEqual(['B', 'A']);
      expect(pluginB.bootstrap).toHaveBeenCalledWith(ctx);
      expect(pluginA.bootstrap).toHaveBeenCalledWith(ctx);
    });
  });

  // ---------- beforeTurn ----------

  describe('beforeTurn', () => {
    it('应按 priority 顺序串行调用插件', async () => {
      const callOrder: string[] = [];
      const pluginA = createMockPlugin('A', 10);
      pluginA.beforeTurn.mockImplementation(async () => { callOrder.push('A'); });
      const pluginB = createMockPlugin('B', 1);
      pluginB.beforeTurn.mockImplementation(async () => { callOrder.push('B'); });
      const pluginC = createMockPlugin('C', 5);
      pluginC.beforeTurn.mockImplementation(async () => { callOrder.push('C'); });

      engine.register(pluginA);
      engine.register(pluginB);
      engine.register(pluginC);

      await engine.beforeTurn(makeTurnContext());

      // B(1) → C(5) → A(10)
      expect(callOrder).toEqual(['B', 'C', 'A']);
    });

    it('当 token 使用率超过 85% 时应触发 compact', async () => {
      const plugin = createMockPlugin('compactor', 1);
      engine.register(plugin);

      const messages = [makeMessage('你好'), makeMessage('回复', 'assistant')];
      // estimatedTokens = 3500, tokenLimit = 4000 → 87.5% > 85%
      const ctx = makeTurnContext({
        messages,
        estimatedTokens: 3500,
        tokenLimit: 4000,
      });

      await engine.beforeTurn(ctx);

      // compact 应该被触发
      expect(plugin.compact).toHaveBeenCalled();
      const compactCall = plugin.compact.mock.calls[0][0] as CompactContext;
      expect(compactCall.tokenUsageRatio).toBeCloseTo(3500 / 4000);
    });

    it('当 token 使用率低于 85% 时不应触发 compact', async () => {
      const plugin = createMockPlugin('compactor', 1);
      engine.register(plugin);

      // estimatedTokens = 3000, tokenLimit = 4000 → 75% < 85%
      await engine.beforeTurn(makeTurnContext({
        estimatedTokens: 3000,
        tokenLimit: 4000,
      }));

      expect(plugin.compact).not.toHaveBeenCalled();
    });
  });

  // ---------- afterTurn ----------

  describe('afterTurn', () => {
    it('应并行调用所有插件（Promise.allSettled）', async () => {
      const pluginA = createMockPlugin('A', 1);
      const pluginB = createMockPlugin('B', 2);

      engine.register(pluginA);
      engine.register(pluginB);

      const ctx = makeTurnContext();
      await engine.afterTurn(ctx);

      expect(pluginA.afterTurn).toHaveBeenCalledWith(ctx);
      expect(pluginB.afterTurn).toHaveBeenCalledWith(ctx);
    });

    it('某个插件报错不应影响其他插件执行', async () => {
      const pluginA = createMockPlugin('A', 1);
      pluginA.afterTurn.mockRejectedValue(new Error('插件 A 出错了'));

      const pluginB = createMockPlugin('B', 2);

      engine.register(pluginA);
      engine.register(pluginB);

      // 不应抛出异常
      await expect(engine.afterTurn(makeTurnContext())).resolves.toBeUndefined();
      // B 仍然应被调用
      expect(pluginB.afterTurn).toHaveBeenCalled();
    });
  });

  // ---------- shutdown ----------

  describe('shutdown', () => {
    it('应按 priority 顺序串行调用', async () => {
      const callOrder: string[] = [];
      const pluginA = createMockPlugin('A', 10);
      pluginA.shutdown.mockImplementation(async () => { callOrder.push('A'); });
      const pluginB = createMockPlugin('B', 1);
      pluginB.shutdown.mockImplementation(async () => { callOrder.push('B'); });

      engine.register(pluginA);
      engine.register(pluginB);

      const ctx = makeShutdownContext();
      await engine.shutdown(ctx);

      expect(callOrder).toEqual(['B', 'A']);
    });
  });

  // ---------- forceTruncate ----------

  describe('forceTruncate', () => {
    it('消息数量超过 N 时应只保留最近 N 条', () => {
      const messages = Array.from({ length: 10 }, (_, i) => makeMessage(`消息 ${i}`));
      const result = engine.forceTruncate(messages, 3);

      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('消息 7');
      expect(result[2].content).toBe('消息 9');
    });

    it('消息数量不超过 N 时应原样返回', () => {
      const messages = [makeMessage('唯一的消息')];
      const result = engine.forceTruncate(messages, 6);

      expect(result).toHaveLength(1);
      expect(result).toBe(messages); // 应该是同一个引用
    });

    it('默认保留 6 条消息', () => {
      const messages = Array.from({ length: 10 }, (_, i) => makeMessage(`消息 ${i}`));
      const result = engine.forceTruncate(messages);

      expect(result).toHaveLength(6);
      expect(result[0].content).toBe('消息 4');
    });
  });

  // ---------- triggerCompact ----------

  describe('triggerCompact', () => {
    it('应按逆序（高 priority 数值先执行）调用插件的 compact', async () => {
      const callOrder: string[] = [];
      const pluginA = createMockPlugin('A', 1);
      pluginA.compact.mockImplementation(async (ctx: CompactContext) => {
        callOrder.push('A');
        return ctx.messages;
      });
      const pluginB = createMockPlugin('B', 10);
      pluginB.compact.mockImplementation(async (ctx: CompactContext) => {
        callOrder.push('B');
        return ctx.messages;
      });

      engine.register(pluginA);
      engine.register(pluginB);

      const messages = [makeMessage('测试')];
      await engine.triggerCompact({
        agentId: 'agent-001',
        sessionKey: 'agent:agent-001:default:direct:user1' as SessionKey,
        messages,
        tokenUsageRatio: 0.9,
      });

      // 逆序：B(priority=10) 先于 A(priority=1)
      expect(callOrder).toEqual(['B', 'A']);
    });

    it('compact 的输出应作为下一个插件的输入（链式传递）', async () => {
      const pluginA = createMockPlugin('A', 1);
      pluginA.compact.mockImplementation(async (ctx: CompactContext) => {
        // A 追加一条消息
        return [...ctx.messages, makeMessage('来自 A')];
      });
      const pluginB = createMockPlugin('B', 10);
      pluginB.compact.mockImplementation(async (ctx: CompactContext) => {
        // B 追加一条消息
        return [...ctx.messages, makeMessage('来自 B')];
      });

      engine.register(pluginA);
      engine.register(pluginB);

      const initialMessages = [makeMessage('初始消息')];
      const result = await engine.triggerCompact({
        agentId: 'agent-001',
        sessionKey: 'agent:agent-001:default:direct:user1' as SessionKey,
        messages: initialMessages,
        tokenUsageRatio: 0.9,
      });

      // 逆序执行：B → A，所以结果应有 3 条消息
      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('初始消息');
      expect(result[1].content).toBe('来自 B');
      expect(result[2].content).toBe('来自 A');
    });
  });
});
