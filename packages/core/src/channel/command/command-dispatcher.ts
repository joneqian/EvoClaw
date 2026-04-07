/**
 * 渠道命令分发器 — 解析 slash command 文本，分发到注册表或 fallback 到技能
 */

import { createLogger } from '../../infrastructure/logger.js';
import type { CommandContext, CommandResult } from './types.js';
import type { CommandRegistry } from './command-registry.js';

const log = createLogger('channel-command');

/** 检查文本是否是 slash command */
export function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

/** 解析 slash command 文本为命令名和参数 */
export function parseSlashCommand(text: string): { name: string; args: string } {
  const trimmed = text.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const rawName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
  // 去掉 / 前缀并转小写
  const name = rawName.slice(1).toLowerCase();
  return { name, args };
}

/** 创建命令分发函数 */
export function createCommandDispatcher(registry: CommandRegistry) {
  return async function dispatchCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
    const { name, args } = parseSlashCommand(text);
    log.info(`渠道命令: /${name}, args: ${args.slice(0, 50)}`);

    // 1. 内置命令
    const cmd = registry.findCommand(name);
    if (cmd) {
      try {
        return await cmd.execute(args, ctx);
      } catch (err) {
        log.error(`命令 /${name} 执行失败: ${err}`);
        return { handled: true, response: `命令 /${name} 执行失败: ${String(err).slice(0, 200)}` };
      }
    }

    // 2. 技能 fallback
    if (ctx.skillDiscoverer) {
      const locals = ctx.skillDiscoverer.listLocal();
      const matched = locals.find(s => s.name.toLowerCase() === name || s.slug?.toLowerCase() === name);
      if (matched) {
        log.info(`命令 /${name} fallback 到技能: ${matched.name}`);
        return {
          handled: true,
          injectToConversation: true,
          skillName: matched.name,
          skillArgs: args,
        };
      }
    }

    // 3. 未知命令
    return { handled: true, response: `未知命令 /${name}，输入 /help 查看可用命令` };
  };
}
