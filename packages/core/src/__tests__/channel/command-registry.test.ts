import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import type { ChannelCommand } from '../../channel/command/types.js';

function makeCommand(name: string, aliases?: string[]): ChannelCommand {
  return {
    name,
    aliases,
    description: `${name} 命令`,
    execute: async () => ({ handled: true, response: name }),
  };
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('注册并按名称查找命令', () => {
    const cmd = makeCommand('help');
    registry.register(cmd);
    expect(registry.findCommand('help')).toBe(cmd);
  });

  it('按别名查找命令', () => {
    const cmd = makeCommand('debug', ['toggle-debug']);
    registry.register(cmd);
    expect(registry.findCommand('toggle-debug')).toBe(cmd);
  });

  it('查找不存在的命令返回 undefined', () => {
    expect(registry.findCommand('nonexistent')).toBeUndefined();
  });

  it('精确名称优先于别名', () => {
    const cmd1 = makeCommand('foo');
    const cmd2 = makeCommand('bar', ['foo']);
    registry.register(cmd1);
    registry.register(cmd2);
    expect(registry.findCommand('foo')).toBe(cmd1);
  });

  it('listCommands 返回所有已注册命令', () => {
    registry.register(makeCommand('help'));
    registry.register(makeCommand('cost'));
    registry.register(makeCommand('model'));
    expect(registry.listCommands()).toHaveLength(3);
  });

  it('命令名匹配忽略大小写', () => {
    registry.register(makeCommand('help'));
    expect(registry.findCommand('HELP')).toBeDefined();
    expect(registry.findCommand('Help')).toBeDefined();
  });

  it('重复注册同名命令覆盖旧命令', () => {
    const old = makeCommand('help');
    const updated = makeCommand('help');
    registry.register(old);
    registry.register(updated);
    expect(registry.findCommand('help')).toBe(updated);
    expect(registry.listCommands()).toHaveLength(1);
  });
});
