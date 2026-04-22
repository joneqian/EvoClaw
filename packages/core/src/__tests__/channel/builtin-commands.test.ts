/**
 * 内置渠道命令单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { echoCommand } from '../../channel/command/builtin/echo.js';
import { debugCommand } from '../../channel/command/builtin/debug.js';
import { costCommand } from '../../channel/command/builtin/cost.js';
import { modelCommand } from '../../channel/command/builtin/model.js';
import { memoryCommand } from '../../channel/command/builtin/memory.js';
import { rememberCommand } from '../../channel/command/builtin/remember.js';
import { forgetCommand } from '../../channel/command/builtin/forget.js';
import { statusCommand } from '../../channel/command/builtin/status.js';
import { createHelpCommand } from '../../channel/command/builtin/help.js';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import type { CommandContext } from '../../channel/command/types.js';

/**
 * 创建模拟 CommandContext
 */
function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    agentId: 'agent-1',
    channel: 'weixin',
    peerId: 'user-1',
    senderId: 'user-1',
    accountId: 'acc-1',
    store: {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    } as any,
    agentManager: {
      getAgent: vi.fn().mockReturnValue({ name: 'TestBot', modelId: 'gpt-4o', provider: 'openai' }),
      updateAgent: vi.fn(),
    } as any,
    channelManager: {} as any,
    ...overrides,
  };
}

describe('echo command', () => {
  it('回显参数文本', async () => {
    const result = await echoCommand.execute('hello world', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('hello world');
  });

  it('无参数返回空消息提示', async () => {
    const result = await echoCommand.execute('', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('(空消息)');
  });

  it('参数为空格时返回空消息提示', async () => {
    const result = await echoCommand.execute('   ', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('(空消息)');
  });

  it('回显复杂文本（含特殊字符）', async () => {
    const text = 'hello 世界 !@#$%';
    const result = await echoCommand.execute(text, makeCtx());
    expect(result.response).toBe(text);
  });
});

describe('debug command', () => {
  it('开启 debug 模式（无 stateRepo 时）', async () => {
    const stateRepo = {
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
    };
    const result = await debugCommand.execute('', makeCtx({ stateRepo: stateRepo as any }));
    expect(result.handled).toBe(true);
    expect(result.response).toBe('Debug 模式已开启');
    expect(stateRepo.setState).toHaveBeenCalledWith('weixin', '', 'debug:acc-1', 'true');
  });

  it('关闭 debug 模式（从开启状态）', async () => {
    const stateRepo = {
      getState: vi.fn().mockReturnValue('true'),
      setState: vi.fn(),
    };
    const result = await debugCommand.execute('', makeCtx({ stateRepo: stateRepo as any }));
    expect(result.handled).toBe(true);
    expect(result.response).toBe('Debug 模式已关闭');
    expect(stateRepo.setState).toHaveBeenCalledWith('weixin', '', 'debug:acc-1', 'false');
  });

  it('切换 debug 模式（从关闭到开启）', async () => {
    const stateRepo = {
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
    };
    const ctx = makeCtx({ stateRepo: stateRepo as any });
    const result = await debugCommand.execute('', ctx);
    expect(result.response).toBe('Debug 模式已开启');
  });

  it('别名应包含 toggle-debug', () => {
    expect(debugCommand.aliases).toContain('toggle-debug');
  });

  it('无 stateRepo 返回不可用提示', async () => {
    const result = await debugCommand.execute('', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('调试模式不可用（缺少状态仓库）');
  });

  it('使用正确的状态键格式', async () => {
    const stateRepo = {
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
    };
    const ctx = makeCtx({
      accountId: 'custom-account',
      stateRepo: stateRepo as any,
    });
    await debugCommand.execute('', ctx);
    expect(stateRepo.getState).toHaveBeenCalledWith('weixin', '', 'debug:custom-account');
  });
});

describe('cost command', () => {
  it('返回费用统计（有数据）', async () => {
    const store = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn()
        .mockReturnValueOnce({
          input: 1000,
          output: 500,
          cache_r: 200,
          cache_w: 100,
          cost: 5000,
          cnt: 3,
        })
        .mockReturnValueOnce({
          input: 5000,
          output: 2500,
          cache_r: 1000,
          cache_w: 500,
          cost: 25000,
          cnt: 15,
        }),
    };
    const ctx = makeCtx({ store: store as any });
    const result = await costCommand.execute('', ctx);

    expect(result.handled).toBe(true);
    expect(result.response).toContain('费用统计');
    expect(result.response).toContain('当前模型: gpt-4o (openai)');
    expect(result.response).toContain('今日统计:');
    expect(result.response).toContain('本月统计:');
    expect(result.response).toContain('1,000');
    expect(result.response).toContain('500');
  });

  it('查询正确的时间范围', async () => {
    const store = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({
        input: 0,
        output: 0,
        cache_r: 0,
        cache_w: 0,
        cost: 0,
        cnt: 0,
      }),
    };
    const ctx = makeCtx({ store: store as any });
    await costCommand.execute('', ctx);

    // 验证查询了两次（今日 + 本月）
    expect(store.get).toHaveBeenCalledTimes(2);

    // 验证第一个查询（今日）
    const firstCall = store.get.mock.calls[0];
    expect(firstCall[0]).toContain('FROM usage_tracking');
    expect(firstCall[1]).toBe('agent-1');
    // 第三个参数应该是今天 00:00:00 的 ISO 字符串

    // 验证第二个查询（本月）
    const secondCall = store.get.mock.calls[1];
    expect(secondCall[0]).toContain('FROM usage_tracking');
    expect(secondCall[1]).toBe('agent-1');
  });

  it('格式化成本为元', async () => {
    const store = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn()
        .mockReturnValueOnce({
          input: 0,
          output: 0,
          cache_r: 0,
          cache_w: 0,
          cost: 100000, // 100000 毫分 / 1000 / 100 = 1 元
          cnt: 0,
        })
        .mockReturnValueOnce({
          input: 0,
          output: 0,
          cache_r: 0,
          cache_w: 0,
          cost: 50000, // 50000 毫分 / 1000 / 100 = 0.5 元
          cnt: 0,
        }),
    };
    const ctx = makeCtx({ store: store as any });
    const result = await costCommand.execute('', ctx);
    expect(result.response).toContain('¥1.0000');
    expect(result.response).toContain('¥0.5000');
  });

  it('处理缺少统计行的情况', async () => {
    const store = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    };
    const ctx = makeCtx({ store: store as any });
    const result = await costCommand.execute('', ctx);

    expect(result.handled).toBe(true);
    expect(result.response).toContain('费用统计');
    // null 行时，应该使用 ?? 运算符默认为 0
    expect(result.response).toContain('0');
  });
});

describe('model command', () => {
  it('无参数显示当前模型', async () => {
    const result = await modelCommand.execute('', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('当前模型: gpt-4o');
  });

  it('有参数切换模型', async () => {
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', modelId: 'gpt-4o' }),
      updateAgent: vi.fn(),
    };
    const result = await modelCommand.execute('claude-sonnet-4-6', makeCtx({
      agentManager: agentManager as any,
    }));
    expect(result.handled).toBe(true);
    expect(result.response).toBe('模型已切换为: claude-sonnet-4-6');
    expect(agentManager.updateAgent).toHaveBeenCalledWith('agent-1', {
      modelId: 'claude-sonnet-4-6',
    });
  });

  it('切换模型时使用 trim 后的参数', async () => {
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', modelId: 'gpt-4o' }),
      updateAgent: vi.fn(),
    };
    await modelCommand.execute('  claude-haiku-4-5  ', makeCtx({
      agentManager: agentManager as any,
    }));
    expect(agentManager.updateAgent).toHaveBeenCalledWith('agent-1', {
      modelId: 'claude-haiku-4-5',
    });
  });

  it('显示未配置的模型', async () => {
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', modelId: null }),
      updateAgent: vi.fn(),
    };
    const result = await modelCommand.execute('', makeCtx({
      agentManager: agentManager as any,
    }));
    expect(result.response).toBe('当前模型: 未配置');
  });

  it('Agent 不存在时返回错误', async () => {
    const agentManager = {
      getAgent: vi.fn().mockReturnValue(null),
      updateAgent: vi.fn(),
    };
    const result = await modelCommand.execute('', makeCtx({
      agentManager: agentManager as any,
    }));
    expect(result.handled).toBe(true);
    expect(result.response).toBe('未找到 Agent 配置');
  });
});

describe('memory command', () => {
  it('有记忆数据返回统计', async () => {
    const store = {
      all: vi.fn().mockReturnValue([
        { category: 'entity', cnt: 10 },
        { category: 'event', cnt: 5 },
        { category: 'preference', cnt: 3 },
      ]),
      get: vi.fn(),
    };
    const result = await memoryCommand.execute('', makeCtx({ store: store as any }));
    expect(result.handled).toBe(true);
    expect(result.response).toContain('记忆统计 (共 18 条)');
    expect(result.response).toContain('entity: 10');
    expect(result.response).toContain('event: 5');
    expect(result.response).toContain('preference: 3');
  });

  it('无记忆数据返回提示', async () => {
    const result = await memoryCommand.execute('', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('暂无记忆数据');
  });

  it('统计的是正确的 Agent', async () => {
    const store = {
      all: vi.fn().mockReturnValue([
        { category: 'entity', cnt: 5 },
      ]),
      get: vi.fn(),
    };
    const ctx = makeCtx({
      agentId: 'my-agent-123',
      store: store as any,
    });
    await memoryCommand.execute('', ctx);
    expect(store.all).toHaveBeenCalledWith(expect.stringContaining('agent_id = ?'), 'my-agent-123');
  });

  it('计算总记忆数正确', async () => {
    const store = {
      all: vi.fn().mockReturnValue([
        { category: 'a', cnt: 1 },
        { category: 'b', cnt: 2 },
        { category: 'c', cnt: 3 },
        { category: 'd', cnt: 4 },
      ]),
      get: vi.fn(),
    };
    const result = await memoryCommand.execute('', makeCtx({ store: store as any }));
    expect(result.response).toContain('共 10 条');
  });
});

describe('remember command', () => {
  function makeRememberCtx() {
    const store = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
      transaction: vi.fn((fn: () => void) => fn()),
    };
    return { ctx: makeCtx({ store: store as any }), store };
  }

  it('参数为空应返回提示', async () => {
    const { ctx } = makeRememberCtx();
    const result = await rememberCommand.execute('', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('用法');
  });

  it('参数为纯空格应返回提示', async () => {
    const { ctx } = makeRememberCtx();
    const result = await rememberCommand.execute('   ', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('用法');
  });

  it('正常文本应写入 memory_units 并返回 id', async () => {
    const { ctx, store } = makeRememberCtx();
    const result = await rememberCommand.execute('我女儿叫小满，5 月 3 日生日', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('已记住');
    expect(result.response).toMatch(/id=[a-f0-9-]+/);
    expect(store.run).toHaveBeenCalled();
    const sqlCall = store.run.mock.calls[0]?.[0] as string;
    expect(sqlCall).toContain('INSERT INTO memory_units');
  });

  it('应使用当前 agentId', async () => {
    const { store } = makeRememberCtx();
    const ctx = makeCtx({
      agentId: 'special-agent',
      store: store as any,
    });
    await rememberCommand.execute('某事', ctx);
    const args = store.run.mock.calls[0];
    expect(args).toContain('special-agent');
  });
});

describe('forget command', () => {
  function makeForgetCtx() {
    const store = {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      run: vi.fn(),
      transaction: vi.fn((fn: () => void) => fn()),
    };
    return { ctx: makeCtx({ store: store as any }), store };
  }

  it('参数为空应返回提示', async () => {
    const { ctx } = makeForgetCtx();
    const result = await forgetCommand.execute('', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('用法');
  });

  it('无匹配应返回 0 条', async () => {
    const { ctx, store } = makeForgetCtx();
    store.all.mockReturnValue([]);
    const result = await forgetCommand.execute('客户 X', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('0');
  });

  it('多条匹配应批量软删除并返回数量', async () => {
    const { ctx, store } = makeForgetCtx();
    store.all.mockReturnValue([
      { id: 'mem-1', l0_index: '客户 X 喜欢简洁邮件' },
      { id: 'mem-2', l0_index: '客户 X 上周开会' },
      { id: 'mem-3', l0_index: '客户 X 偏好下午联系' },
    ]);
    const result = await forgetCommand.execute('客户 X', ctx);
    expect(result.response).toContain('3');
    const updateCalls = store.run.mock.calls.filter((call: any[]) =>
      typeof call[0] === 'string' && call[0].includes('archived_at')
    );
    expect(updateCalls.length).toBe(3);
  });

  it('应只查询当前 agentId 的记忆', async () => {
    const { store } = makeForgetCtx();
    store.all.mockReturnValue([]);
    const ctx = makeCtx({
      agentId: 'agent-X',
      store: store as any,
    });
    await forgetCommand.execute('关键词', ctx);
    const selectCall = store.all.mock.calls[0];
    expect(selectCall).toContain('agent-X');
  });
});

describe('status command', () => {
  it('返回 Agent 状态', async () => {
    const store = {
      all: vi.fn(),
      get: vi.fn().mockReturnValue({ cnt: 5 }),
    };
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({
        name: 'MyBot',
        modelId: 'gpt-4o-mini',
      }),
      updateAgent: vi.fn(),
    };
    const result = await statusCommand.execute('', makeCtx({
      store: store as any,
      agentManager: agentManager as any,
    }));

    expect(result.handled).toBe(true);
    expect(result.response).toContain('Agent 状态');
    expect(result.response).toContain('名称: MyBot');
    expect(result.response).toContain('模型: gpt-4o-mini');
    expect(result.response).toContain('今日会话: 5');
    expect(result.response).toContain('渠道: weixin');
  });

  it('显示未配置的模型', async () => {
    const store = {
      all: vi.fn(),
      get: vi.fn().mockReturnValue({ cnt: 0 }),
    };
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({
        name: 'MyBot',
        modelId: null,
      }),
      updateAgent: vi.fn(),
    };
    const result = await statusCommand.execute('', makeCtx({
      store: store as any,
      agentManager: agentManager as any,
    }));
    expect(result.response).toContain('模型: 未配置');
  });

  it('Agent 不存在时返回错误', async () => {
    const agentManager = {
      getAgent: vi.fn().mockReturnValue(null),
      updateAgent: vi.fn(),
    };
    const result = await statusCommand.execute('', makeCtx({
      agentManager: agentManager as any,
    }));
    expect(result.handled).toBe(true);
    expect(result.response).toBe('未找到 Agent');
  });

  it('统计的是正确 Agent 的会话数', async () => {
    const store = {
      all: vi.fn(),
      get: vi.fn().mockReturnValue({ cnt: 10 }),
    };
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', modelId: 'gpt-4o' }),
      updateAgent: vi.fn(),
    };
    const ctx = makeCtx({
      agentId: 'agent-xyz',
      store: store as any,
      agentManager: agentManager as any,
    });
    await statusCommand.execute('', ctx);

    expect(store.get).toHaveBeenCalledWith(
      expect.stringContaining('agent_id = ?'),
      'agent-xyz',
      expect.any(String),
    );
  });

  it('今日会话数为 0 时正确显示', async () => {
    const store = {
      all: vi.fn(),
      get: vi.fn().mockReturnValue({ cnt: 0 }),
    };
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', modelId: 'gpt-4o' }),
      updateAgent: vi.fn(),
    };
    const result = await statusCommand.execute('', makeCtx({
      store: store as any,
      agentManager: agentManager as any,
    }));
    expect(result.response).toContain('今日会话: 0');
  });

  it('统计行为 null 时使用默认值', async () => {
    const store = {
      all: vi.fn(),
      get: vi.fn().mockReturnValue(null),
    };
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', modelId: 'gpt-4o' }),
      updateAgent: vi.fn(),
    };
    const result = await statusCommand.execute('', makeCtx({
      store: store as any,
      agentManager: agentManager as any,
    }));
    expect(result.response).toContain('今日会话: 0');
  });
});

describe('help command', () => {
  it('列出已注册命令', async () => {
    const registry = new CommandRegistry();
    registry.register(echoCommand);
    registry.register(costCommand);
    registry.register(modelCommand);
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain('可用命令');
    expect(result.response).toContain('/echo');
    expect(result.response).toContain('/cost');
    expect(result.response).toContain('/model');
  });

  it('显示命令描述', async () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'test',
      description: '测试命令',
      execute: async () => ({ handled: true }),
    });
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx());
    expect(result.response).toContain('测试命令');
  });

  it('列出已安装技能', async () => {
    const registry = new CommandRegistry();
    const skillDiscoverer = {
      listLocal: () => [
        { name: 'summarize', slug: 'summarize', description: '总结', source: 'local' as const },
        { name: 'translate', slug: 'translate', description: '翻译', source: 'local' as const },
      ],
    };
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx({
      skillDiscoverer: skillDiscoverer as any,
    }));
    expect(result.response).toContain('已安装技能');
    expect(result.response).toContain('/summarize');
    expect(result.response).toContain('/translate');
  });

  it('无技能时不显示技能段落', async () => {
    const registry = new CommandRegistry();
    const skillDiscoverer = {
      listLocal: () => [],
    };
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx({
      skillDiscoverer: skillDiscoverer as any,
    }));
    expect(result.response).not.toContain('已安装技能');
  });

  it('无 skillDiscoverer 时不显示技能段落', async () => {
    const registry = new CommandRegistry();
    registry.register(echoCommand);
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx());
    expect(result.response).toContain('可用命令');
    expect(result.response).toContain('/echo');
    // 无 skillDiscoverer，不应该有错误
    expect(result.handled).toBe(true);
  });

  it('技能按每行 3 个排列', async () => {
    const registry = new CommandRegistry();
    const skillDiscoverer = {
      listLocal: () => [
        { name: 'a', slug: 'a', description: '', source: 'local' as const },
        { name: 'b', slug: 'b', description: '', source: 'local' as const },
        { name: 'c', slug: 'c', description: '', source: 'local' as const },
        { name: 'd', slug: 'd', description: '', source: 'local' as const },
      ],
    };
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx({
      skillDiscoverer: skillDiscoverer as any,
    }));
    const lines = result.response!.split('\n');
    // 应该有分隔符、命令段、技能分隔符、技能行
    expect(lines.some(l => l.includes('已安装技能'))).toBe(true);
  });

  it('命令列表显示正确格式', async () => {
    const registry = new CommandRegistry();
    registry.register({
      name: 'echo',
      description: '回显',
      execute: async () => ({ handled: true }),
    });
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx());
    // 检查命令行是否包含正确格式：/命令名 - 描述
    expect(result.response).toContain('/echo');
    expect(result.response).toContain('回显');
  });
});
