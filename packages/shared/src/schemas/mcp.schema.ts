/**
 * McpServerConfig Zod Schema
 */

import { z } from 'zod';

/** MCP 服务器配置 schema */
export const mcpServerConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['stdio', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  startupTimeoutMs: z.number().int().positive().optional(),
});

/** 安全解析单个 MCP 配置 */
export function safeParseMcpConfig(data: unknown) {
  return mcpServerConfigSchema.safeParse(data);
}

/** 安全解析 MCP 配置数组 */
export function safeParseMcpConfigs(data: unknown) {
  return z.array(mcpServerConfigSchema).safeParse(data);
}
