/**
 * /help — 列出所有可用命令和已安装技能
 */

import type { ChannelCommand } from '../types.js';
import type { CommandRegistry } from '../command-registry.js';

/** 创建 help 命令（需要 registry 引用来列举命令） */
export function createHelpCommand(registry: CommandRegistry): ChannelCommand {
  return {
    name: 'help',
    description: '显示可用命令列表',
    async execute(_args, ctx) {
      const lines: string[] = ['━━━ 可用命令 ━━━'];

      // 列出所有内置命令
      for (const cmd of registry.listCommands()) {
        const nameStr = `/${cmd.name}`.padEnd(12);
        lines.push(`${nameStr} - ${cmd.description}`);
      }

      // 列出已安装技能
      if (ctx.skillDiscoverer) {
        const skills = ctx.skillDiscoverer.listLocal();
        if (skills.length > 0) {
          lines.push(`━━━ 已安装技能 (${skills.length}) ━━━`);
          const skillNames = skills.map(s => `/${s.name}`);
          // 每行最多 3 个技能名
          for (let i = 0; i < skillNames.length; i += 3) {
            lines.push(skillNames.slice(i, i + 3).join('  '));
          }
        }
      }

      return { handled: true, response: lines.join('\n') };
    },
  };
}
