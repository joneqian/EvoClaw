/**
 * 通用命令注册表 — 泛型化（M3-T3a）。
 *
 * 原本仅限渠道命令使用，现在泛型化为 `CommandRegistry<T extends BaseCommandMeta>`，
 * 便于未来为 Slash 命令、Agent 工具命令等复用同一套注册/查找/列举逻辑。
 * 默认类型参数保持为 `ChannelCommand`，原有调用点零改动。
 */

import type { BaseCommandMeta, ChannelCommand } from './types.js';

export class CommandRegistry<T extends BaseCommandMeta = ChannelCommand> {
  private readonly commands = new Map<string, T>();

  /** 注册命令（同名覆盖，按 name.toLowerCase() 作为 key） */
  register(cmd: T): void {
    this.commands.set(cmd.name.toLowerCase(), cmd);
  }

  /** 按名称或别名查找命令（忽略大小写） */
  findCommand(name: string): T | undefined {
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
  listCommands(): T[] {
    return [...this.commands.values()];
  }
}
