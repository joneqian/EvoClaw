/**
 * MCP (Model Context Protocol) 类型定义
 *
 * McpServerConfig 从 Zod Schema 推断（单一事实来源）
 * 其余类型为运行时结构体，手写即可
 *
 * 参考: https://modelcontextprotocol.io/
 */

import type { z } from 'zod';
import type { mcpServerConfigSchema } from '../schemas/mcp.schema.js';

/** MCP Server 配置 — 从 Schema 推断 */
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

/** MCP 工具定义（从 MCP Server 发现的工具） */
export interface McpToolInfo {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description?: string;
  /** JSON Schema 形式的参数定义 */
  inputSchema: Record<string, unknown>;
  /** 来源 MCP Server 名称 */
  serverName: string;
}

/** MCP 工具调用结果 */
export interface McpToolResult {
  /** 结果内容列表 */
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  /** 是否为错误结果 */
  isError?: boolean;
}

/** MCP Server 运行状态 */
export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

/** MCP Server 运行时信息 */
export interface McpServerState {
  /** 配置 */
  config: McpServerConfig;
  /** 当前状态 */
  status: McpServerStatus;
  /** 已发现的工具列表 */
  tools: McpToolInfo[];
  /** 错误信息（status=error 时） */
  error?: string;
}
