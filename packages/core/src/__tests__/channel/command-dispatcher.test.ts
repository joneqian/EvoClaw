import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import { createCommandDispatcher, isSlashCommand, parseSlashCommand } from '../../channel/command/command-dispatcher.js';
import type { CommandContext, ChannelCommand } from '../../channel/command/types.js';

// Mock logger
vi.mock('../../infrastructure/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    agentId: 'agent-1',
    channel: 'weixin',
    peerId: 'user-1',
    senderId: 'user-1',
    accountId: 'acc-1',
    store: {} as any,
    agentManager: {} as any,
    channelManager: {} as any,
    ...overrides,
  };
}

describe('isSlashCommand', () => {
  it('识别 / 开头文本', () => {
    expect(isSlashCommand('/help')).toBe(true);
    expect(isSlashCommand('  /cost')).toBe(true);
  });

  it('非 / 开头返回 false', () => {
    expect(isSlashCommand('hello')).toBe(false);
    expect(isSlashCommand('')).toBe(false);
  });
});

describe('parseSlashCommand', () => {
  it('解析命令名和参数', () => {
    expect(parseSlashCommand('/model gpt-4o')).toEqual({ name: 'model', args: 'gpt-4o' });
  });

  it('无参数命令', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: '' });
  });

  it('大写命令名转小写', () => {
    expect(parseSlashCommand('/HELP')).toEqual({ name: 'help', args: '' });
  });
});

describe('createCommandDispatcher', () => {
  let registry: CommandRegistry;
  let dispatch: ReturnType<typeof createCommandDispatcher>;

  beforeEach(() => {
    registry = new CommandRegistry();
    dispatch = createCommandDispatcher(registry);
  });

  it('匹配内置命令并执行', async () => {
    const cmd: ChannelCommand = {
      name: 'help',
      description: '帮助',
      execute: async () => ({ handled: true, response: '帮助信息' }),
    };
    registry.register(cmd);

    const result = await dispatch('/help', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('帮助信息');
  });

  it('未匹配命令 + 无 skillDiscoverer → 未知命令提示', async () => {
    const result = await dispatch('/unknown', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain('未知命令');
    expect(result.response).toContain('/help');
  });

  it('未匹配命令 + skillDiscoverer 找到技能 → injectToConversation', async () => {
    const mockDiscoverer = {
      listLocal: () => [{ name: 'summarize', slug: 'summarize', description: '总结', source: 'local' as const }],
    };
    const ctx = makeCtx({ skillDiscoverer: mockDiscoverer as any });

    const result = await dispatch('/summarize 最近的对话', ctx);
    expect(result.handled).toBe(true);
    expect(result.injectToConversation).toBe(true);
    expect(result.skillName).toBe('summarize');
    expect(result.skillArgs).toBe('最近的对话');
  });

  it('未匹配命令 + skillDiscoverer 未找到技能 → 未知命令提示', async () => {
    const mockDiscoverer = {
      listLocal: () => [],
    };
    const ctx = makeCtx({ skillDiscoverer: mockDiscoverer as any });

    const result = await dispatch('/nonexistent', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('未知命令');
  });

  it('命令执行出错返回错误信息', async () => {
    const cmd: ChannelCommand = {
      name: 'broken',
      description: '坏命令',
      execute: async () => { throw new Error('boom'); },
    };
    registry.register(cmd);

    const result = await dispatch('/broken', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain('执行失败');
  });
});
