/**
 * MCP 服务器指令注入插件
 *
 * 每个已连接 MCP 服务器的 instructions 独立注入为一个段落。
 * 注入到 system prompt 中，让模型了解 MCP 服务器的能力和使用方式。
 */

import type { ContextPlugin, TurnContext } from '../plugin.interface.js';

// 避免 context → mcp 层级违反：用接口替代直接导入
interface McpInstructionsProvider {
  getAllInstructions(): Array<{ name: string; instructions: string }>;
}

/** 创建 MCP 指令注入插件 */
export function createMcpInstructionsPlugin(mcpManager: McpInstructionsProvider): ContextPlugin {
  return {
    name: 'mcp-instructions',
    priority: 55,

    async beforeTurn(ctx: TurnContext) {
      const serverInstructions = mcpManager.getAllInstructions();
      if (serverInstructions.length === 0) return;

      const instructions = serverInstructions
        .map(s => `## ${s.name}\n${s.instructions}`)
        .join('\n\n');

      ctx.injectedContext.push(`<mcp_instructions>\n${instructions}\n</mcp_instructions>`);
      ctx.estimatedTokens += Math.ceil(instructions.length / 4);
    },
  };
}
