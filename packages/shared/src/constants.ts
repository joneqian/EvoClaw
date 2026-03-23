/** Sidecar 端口范围 */
export const PORT_RANGE = { min: 49152, max: 65535 } as const;

/** Bearer Token 长度（bytes） */
export const TOKEN_BYTES = 32; // 256-bit

import { BRAND_DATA_DIR, BRAND_DB_FILENAME } from './brand.js';

/** 默认数据目录（由品牌配置决定） */
export const DEFAULT_DATA_DIR = BRAND_DATA_DIR;

/** 数据库文件名（由品牌配置决定） */
export const DB_FILENAME = BRAND_DB_FILENAME;

/** Agent 工作区目录名 */
export const AGENTS_DIR = 'agents';

/** 共享工作目录名 — 所有 Agent 的 cwd，协作文件在此共享 */
export const SHARED_WORKSPACE_DIR = 'workspace';

/** 默认 fallback 模型 */
export const FALLBACK_MODEL = {
  provider: 'openai',
  modelId: 'gpt-4o-mini',
} as const;

/** 记忆 L0 最大 token 数 */
export const MEMORY_L0_MAX_TOKENS = 100;

/** 记忆 L1 最大 token 数 */
export const MEMORY_L1_MAX_TOKENS = 2000;

/** 记忆 L2 检索总预算 token 数 */
export const MEMORY_L2_BUDGET_TOKENS = 8000;

/** Hotness 衰减半衰期（天） */
export const HOTNESS_HALF_LIFE_DAYS = 7;

/** Lane Queue 默认并发 */
export const LANE_CONCURRENCY = {
  main: 4,
  subagent: 8,
  cron: 2,
} as const;

/** Agent 工作区 8 文件 */
export const AGENT_WORKSPACE_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'AGENTS.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'USER.md',
  'MEMORY.md',
  'BOOTSTRAP.md',
] as const;
