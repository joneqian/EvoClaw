/**
 * ExtensionPackManifest Zod Schema
 */

import { z } from 'zod';
import { extensionSecurityPolicySchema } from './security.schema.js';

/** MCP Server 配置（内联定义避免循环） */
const mcpServerConfigInline = z.object({
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

/** 扩展包 manifest schema */
export const extensionPackManifestSchema = z.object({
  manifestVersion: z.literal(1),
  name: z.string().min(1, '缺少 name 字段'),
  description: z.string().min(1, '缺少 description 字段'),
  version: z.string().min(1, '缺少 version 字段'),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServerConfigInline).optional(),
  securityPolicy: extensionSecurityPolicySchema.optional(),
});

/** 安全解析扩展包 manifest */
export function safeParseManifest(data: unknown) {
  return extensionPackManifestSchema.safeParse(data);
}
