/**
 * ExtensionPackManifest Zod Schema
 */

import { z } from 'zod';
import { extensionSecurityPolicySchema } from './security.schema.js';
import { mcpServerConfigSchema } from './mcp.schema.js';

/** 扩展包 manifest schema */
export const extensionPackManifestSchema = z.object({
  manifestVersion: z.literal(1),
  name: z.string().min(1, '缺少 name 字段'),
  description: z.string().min(1, '缺少 description 字段'),
  version: z.string().min(1, '缺少 version 字段'),
  author: z.string().optional(),
  skills: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServerConfigSchema).optional(),
  securityPolicy: extensionSecurityPolicySchema.optional(),
});

/** 安全解析扩展包 manifest */
export function safeParseManifest(data: unknown) {
  return extensionPackManifestSchema.safeParse(data);
}
