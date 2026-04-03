/**
 * Zod Schema 定义 — 统一验证外部输入
 *
 * 所有从外部进入系统的数据（配置文件、API 请求、ZIP manifest）
 * 都应通过这些 schema 验证，而非直接 `as T` 类型断言。
 *
 * 使用方式:
 *   import { configSchema, safeParseConfig } from '@evoclaw/shared/schemas';
 *   const result = safeParseConfig(jsonData);
 *   if (!result.success) { log.error(result.error.issues); }
 */

export {
  configSchema,
  modelsConfigSchema,
  providerEntrySchema,
  modelEntrySchema,
  safeParseConfig,
} from './config.schema.js';

export {
  extensionSecurityPolicySchema,
  nameSecurityPolicySchema,
  safeParseSecurityPolicy,
} from './security.schema.js';

export {
  extensionPackManifestSchema,
  safeParseManifest,
} from './extension-pack.schema.js';

export {
  mcpServerConfigSchema,
  safeParseMcpConfig,
  safeParseMcpConfigs,
} from './mcp.schema.js';
