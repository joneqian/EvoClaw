/**
 * MCP 工具适配器 — 将 MCP 服务器工具转为 KernelTool
 *
 * 参考 Claude Code MCP 工具集成:
 * - MCP 工具与内置工具统一处理
 * - 通过 isMcp + mcpInfo 区分
 * - 去重时内置工具优先
 *
 * 当前预埋框架，EvoClaw MCP 集成完成后启用。
 */

import type { KernelTool, ToolCallResult } from './types.js';

/** MCP 工具定义（从 MCP 服务器获取） */
export interface McpToolDefinition {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 格式的参数定义 */
  inputSchema: Record<string, unknown>;
  /** MCP 服务器名称 */
  serverName: string;
  /** 是否始终加载（不延迟） */
  alwaysLoad?: boolean;
}

/** MCP 工具执行回调 */
export type McpToolExecutor = (
  serverName: string,
  toolName: string,
  input: Record<string, unknown>,
) => Promise<{ content: string; isError?: boolean }>;

/**
 * 将 MCP 工具定义转为 KernelTool
 *
 * @param def MCP 工具定义
 * @param executor MCP 执行回调（委托给 MCP 客户端）
 */
export function adaptMcpTool(
  def: McpToolDefinition,
  executor: McpToolExecutor,
): KernelTool {
  return {
    name: def.name,
    description: `[MCP:${def.serverName}] ${def.description}`,
    inputSchema: def.inputSchema,
    searchHint: `mcp ${def.serverName} ${def.name}`,
    shouldDefer: !def.alwaysLoad,

    async call(input: Record<string, unknown>): Promise<ToolCallResult> {
      const result = await executor(def.serverName, def.name, input);
      return { content: result.content, isError: result.isError };
    },

    isReadOnly: () => false,  // MCP 工具默认不安全（fail-closed）
    isConcurrencySafe: () => false,
  };
}

/**
 * 合并内置工具和 MCP 工具，内置优先（同名时内置覆盖 MCP）
 */
export function mergeToolPools(
  builtinTools: readonly KernelTool[],
  mcpTools: readonly KernelTool[],
): KernelTool[] {
  const toolMap = new Map<string, KernelTool>();

  // MCP 先加入
  for (const tool of mcpTools) {
    toolMap.set(tool.name, tool);
  }
  // 内置后加入（覆盖同名 MCP）
  for (const tool of builtinTools) {
    toolMap.set(tool.name, tool);
  }

  return [...toolMap.values()];
}
