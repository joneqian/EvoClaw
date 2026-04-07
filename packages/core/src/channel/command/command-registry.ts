/**
 * 渠道命令注册表 — 注册、查找、列举渠道命令
 */

import type { ChannelCommand } from './types.js';

export class CommandRegistry {
  private readonly commands = new Map<string, ChannelCommand>();

  /** 注册命令（同名覆盖） */
  register(cmd: ChannelCommand): void {
    this.commands.set(cmd.name.toLowerCase(), cmd);
  }

  /** 按名称或别名查找命令（忽略大小写） */
  findCommand(name: string): ChannelCommand | undefined {
    const normalized = name.toLowerCase();

    // 1. 精确名称匹配
    const exact = this.commands.get(normalized);
    if (exact) return exact;

    // 2. 别名匹配
    for (const cmd of this.commands.values()) {
      if (cmd.aliases?.some(a => a.toLowerCase() === normalized)) {
        return cmd;
      }
    }

    return undefined;
  }

  /** 列出所有已注册命令 */
  listCommands(): ChannelCommand[] {
    return [...this.commands.values()];
  }
}
