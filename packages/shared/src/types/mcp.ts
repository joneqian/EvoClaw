/**
 * MCP (Model Context Protocol) 类型定义
 *
 * MCP 允许 Agent 连接外部工具服务器，动态发现和调用工具。
 * 参考: https://modelcontextprotocol.io/
 */

/** MCP Server 配置 */
export interface McpServerConfig {
  /** 服务器名称（唯一标识） */
  name: string;
  /** 启动命令（如 npx, node, python 等） */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 启动超时（毫秒，默认 30000） */
  startupTimeoutMs?: number;
}

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
