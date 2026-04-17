/**
 * 命令清单 API（M3-T3b）
 *
 * `GET /api/commands` 返回 `{ routes, tools, channelCommands }` 给前端命令面板
 * （Cmd+K）与 Settings 的 "API 文档" Tab。数据源：
 * - ROUTE_MANIFEST / TOOL_MANIFEST（routes/command-manifest.ts）
 * - 传入的 channelCommandRegistry.listCommands()（运行时动态注册的渠道命令）
 */

import { Hono } from 'hono';
import type { CommandRegistry } from '../channel/command/command-registry.js';
import type { ChannelCommand } from '../channel/command/types.js';
import { ROUTE_MANIFEST, TOOL_MANIFEST } from './command-manifest.js';

/**
 * 创建命令清单路由。
 * @param channelCommandRegistry 运行时渠道命令注册表（可选；未配置渠道时为 undefined）
 */
export function createCommandsRoutes(
  channelCommandRegistry?: CommandRegistry<ChannelCommand>,
): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const channelCommands = channelCommandRegistry
      ? channelCommandRegistry.listCommands().map(cmd => ({
          name: cmd.name,
          aliases: cmd.aliases ?? [],
          description: cmd.description,
          category: cmd.category ?? 'channel',
        }))
      : [];

    return c.json({
      routes: ROUTE_MANIFEST,
      tools: TOOL_MANIFEST,
      channelCommands,
    });
  });

  return app;
}
