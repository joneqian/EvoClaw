/**
 * MCP Tool Bridge — 将 MCP 工具转换为 EvoClaw ToolDefinition 格式
 *
 * 处理：
 * - MCP tool → EvoClaw ToolDefinition 转换
 * - 工具名称冲突检测（与内置工具和其他 MCP Server 的冲突）
 * - 工具名称前缀（server_name:tool_name）避免冲突
 */

import type { McpToolInfo, McpToolResult } from '@evoclaw/shared';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { McpManager } from './mcp-client.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-tool-bridge');

/** EvoClaw 保留的工具名称 — MCP 工具不能使用这些名称 */
const RESERVED_TOOL_NAMES = new Set([
  // PI 内置工具
  'read', 'write', 'edit', 'bash', 'grep', 'find', 'ls',
  // EvoClaw 增强工具
  'web_search', 'web_fetch', 'image', 'pdf', 'apply_patch',
  'exec_background', 'process',
  // 记忆工具
  'memory_search', 'memory_get', 'knowledge_query',
  // 子 Agent 工具
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',
]);

/**
 * 将 MCP 工具转换为 EvoClaw ToolDefinition
 * @param mcpTool - MCP 工具信息
 * @param manager - MCP Manager 实例（用于代理调用）
 * @returns EvoClaw ToolDefinition
 */
export function mcpToolToDefinition(
  mcpTool: McpToolInfo,
  manager: McpManager,
): ToolDefinition {
  // 使用 mcp_serverName_toolName 格式避免冲突
  const qualifiedName = `mcp_${mcpTool.serverName}_${mcpTool.name}`;

  return {
    name: qualifiedName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name} (from ${mcpTool.serverName})`,
    parameters: mcpTool.inputSchema as Record<string, unknown>,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const result: McpToolResult = await manager.callTool(
        mcpTool.serverName,
        mcpTool.name,
        args,
      );

      // 将 MCP 结果转为字符串
      const textParts = result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!);

      if (textParts.length === 0) {
        return result.isError ? '[MCP 工具执行错误：无文本输出]' : '(无输出)';
      }

      const output = textParts.join('\n');
      if (result.isError) {
        return `[MCP 错误] ${output}`;
      }
      return output;
    },
  };
}

/**
 * 批量转换并检测冲突
 * @param manager - MCP Manager 实例
 * @param existingToolNames - 已存在的工具名称集合
 * @returns 转换后的 ToolDefinition 列表
 */
export function bridgeAllMcpTools(
  manager: McpManager,
  existingToolNames?: Set<string>,
): ToolDefinition[] {
  const allMcpTools = manager.getAllTools();
  return bridgeMcpToolList(allMcpTools, manager, existingToolNames);
}

/**
 * 桥接指定 MCP 服务器的工具（Agent 级 MCP 过滤）
 * @param manager - MCP Manager 实例
 * @param serverNames - 允许的 MCP 服务器名称列表（undefined/空 = 全部）
 * @param existingToolNames - 已存在的工具名称集合
 * @returns 过滤后的 ToolDefinition 列表
 */
export function bridgeMcpToolsForAgent(
  manager: McpManager,
  serverNames: string[] | undefined,
  existingToolNames?: Set<string>,
): ToolDefinition[] {
  const allMcpTools = manager.getAllTools();

  // undefined 或空数组 = 使用全部可用服务器
  if (!serverNames || serverNames.length === 0) {
    return bridgeMcpToolList(allMcpTools, manager, existingToolNames);
  }

  const allowedServers = new Set(serverNames);
  const filtered = allMcpTools.filter((t) => allowedServers.has(t.serverName));

  if (filtered.length < allMcpTools.length) {
    log.info(
      `Agent MCP 过滤: ${filtered.length}/${allMcpTools.length} 工具 ` +
      `(允许服务器: ${serverNames.join(', ')})`,
    );
  }

  return bridgeMcpToolList(filtered, manager, existingToolNames);
}

/** 内部: 将 MCP 工具列表转为 ToolDefinition 列表 */
function bridgeMcpToolList(
  mcpTools: readonly import('@evoclaw/shared').McpToolInfo[],
  manager: McpManager,
  existingToolNames?: Set<string>,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const seen = new Set<string>();

  for (const mcpTool of mcpTools) {
    if (RESERVED_TOOL_NAMES.has(mcpTool.name)) {
      log.warn(
        `MCP 工具 "${mcpTool.name}" (from ${mcpTool.serverName}) 与保留工具名冲突，` +
        `将使用前缀名称 mcp_${mcpTool.serverName}_${mcpTool.name}`,
      );
    }

    const definition = mcpToolToDefinition(mcpTool, manager);

    if (seen.has(definition.name) || existingToolNames?.has(definition.name)) {
      log.warn(`MCP 工具名称冲突，跳过: ${definition.name}`);
      continue;
    }

    seen.add(definition.name);
    tools.push(definition);
  }

  if (tools.length > 0) {
    log.info(`已桥接 ${tools.length} 个 MCP 工具: ${tools.map((t) => t.name).join(', ')}`);
  }

  return tools;
}
