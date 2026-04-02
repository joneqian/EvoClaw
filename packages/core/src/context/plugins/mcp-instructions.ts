/**
 * MCP 服务器指令注入插件
 *
 * 参考 Claude Code systemPromptSections.ts 的 MCP Server Instructions 段落。
 * 每个已连接 MCP 服务器的 instructions 独立注入为一个段落。
 *
 * 当前 EvoClaw 未集成 MCP 协议，此插件预埋框架。
 * getMcpServers() 返回空数组，不影响现有功能。
 */

import type { ContextPlugin, TurnContext } from '../plugin.interface.js';

/** MCP 服务器信息 */
export interface McpServerInfo {
  name: string;
  instructions?: string;
}

/** 获取当前 Agent 已连接的 MCP 服务器（预埋入口，当前返回空） */
function getMcpServers(_agentId: string): McpServerInfo[] {
  // TODO: 当 MCP 集成完成后，从 Agent 配置或运行时状态获取
  return [];
}

export const mcpInstructionsPlugin: ContextPlugin = {
  name: 'mcp-instructions',
  priority: 55, // 在 tool-registry (60) 之前

  async beforeTurn(ctx: TurnContext) {
    const servers = getMcpServers(ctx.agentId);
    if (servers.length === 0) return;

    const instructions = servers
      .filter(s => s.instructions)
      .map(s => `## ${s.name}\n${s.instructions}`)
      .join('\n\n');

    if (instructions) {
      ctx.injectedContext.push(`<mcp_instructions>\n${instructions}\n</mcp_instructions>`);
      ctx.estimatedTokens += Math.ceil(instructions.length / 4);
    }
  },
};
