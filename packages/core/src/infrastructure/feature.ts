/**
 * Feature Flag 模块
 *
 * 双模式运行：
 * - 生产构建：esbuild `define` 将 FEATURE_* 替换为常量 → tree shake 移除未启用分支
 * - 开发模式：tsx watch 不经过 esbuild，回退到 ENABLE_* 环境变量
 *
 * 使用示例：
 *   import { Feature } from './infrastructure/feature.js';
 *   if (Feature.WEIXIN) {
 *     const { WeixinAdapter } = await import('./channel/adapters/weixin.js');
 *   }
 *
 * 添加新 Feature Flag 步骤：
 *   1. 在 FEATURE_REGISTRY 添加条目
 *   2. 在 feature-flags.d.ts 添加 declare const
 *   3. 在 Feature 对象添加 getter
 *   (CI 脚本 scripts/check-feature-flags.ts 校验三处一致性)
 */

// ─── Feature 注册表（单一真相来源）───────────────────────────────────

/** Feature 元数据 */
export interface FeatureMeta {
  /** 功能描述 */
  readonly desc: string;
  /** 门控的模块路径 glob（用于诊断，非运行时逻辑） */
  readonly modules: readonly string[];
}

/**
 * Feature Flag 注册表 — 所有 Flag 的唯一定义处
 *
 * build.ts 从此注册表自动生成 esbuild define，
 * scripts/check-feature-flags.ts 校验与 feature-flags.d.ts 一致。
 */
export const FEATURE_REGISTRY = {
  WEIXIN:     { desc: '微信个人号渠道',                  modules: ['channel/adapters/weixin*'] },
  MCP:        { desc: 'MCP 服务器集成',                  modules: ['mcp/*', 'routes/mcp*'] },
  SILK_VOICE: { desc: 'SILK 语音转码（微信语音消息）',   modules: ['channel/adapters/weixin-silk*'] },
  WECOM:      { desc: '企业微信渠道',                    modules: ['channel/adapters/wecom*'] },
  FEISHU:     { desc: '飞书渠道',                        modules: ['channel/adapters/feishu*'] },

  // ─── Kernel 能力 Flag（仅门控未验证的新行为） ───
  CACHED_MICROCOMPACT:    { desc: '缓存感知微压缩',          modules: ['agent/kernel/context-compactor*'] },
  REACTIVE_COMPACT:       { desc: '响应式渐进压缩',          modules: ['agent/kernel/context-compactor*'] },
  SESSION_MEMORY_COMPACT: { desc: 'Session Memory 零成本压缩', modules: ['agent/kernel/context-compactor*', 'agent/kernel/session-memory-compact*'] },
} as const satisfies Record<string, FeatureMeta>;

/** 所有 Feature Flag 名称 */
export type FeatureName = keyof typeof FEATURE_REGISTRY;

/** 注册表中所有 Flag 名称列表（运行时可用） */
export const FEATURE_NAMES = Object.keys(FEATURE_REGISTRY) as FeatureName[];

// ─── Feature Flag 运行时查询 ─────────────────────────────────────

/**
 * 品牌默认值缓存（从 .env.brand 读取，仅开发模式）
 *
 * 优先级: 环境变量 ENABLE_* > .env.brand 品牌默认值 > false
 */
let _brandDefaults: Record<string, boolean> | null = null;

function loadBrandDefaults(): Record<string, boolean> {
  if (_brandDefaults) return _brandDefaults;
  _brandDefaults = {};
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    // .env.brand 位于 packages/core/ 根目录
    const envPath = path.resolve(import.meta.dirname ?? __dirname, '..', '.env.brand');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8') as string;
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx);
          const value = trimmed.slice(eqIdx + 1);
          _brandDefaults![key] = value === 'true';
        }
      }
    }
  } catch {
    // 生产构建中此分支被 tree-shake，失败时静默
  }
  return _brandDefaults;
}

/**
 * 开发模式回退：环境变量 > .env.brand 品牌默认值 > false
 * 仅当编译时常量不存在时使用（tsx watch 场景）
 */
function devFallback(name: string): boolean {
  const envKey = `ENABLE_${name}`;
  if (process.env[envKey] !== undefined) {
    return process.env[envKey] === 'true';
  }
  return loadBrandDefaults()[envKey] ?? false;
}

/**
 * Feature Flag 对象
 *
 * 每个 getter 检查编译时常量是否存在：
 * - 存在 → 直接使用（生产构建，已被 esbuild 替换为常量）
 * - 不存在 → 回退到环境变量（开发模式）
 */
export const Feature = {
  /** 微信个人号渠道 */
  get WEIXIN(): boolean {
    return typeof FEATURE_WEIXIN !== 'undefined' ? FEATURE_WEIXIN : devFallback('WEIXIN');
  },

  /** MCP 服务器集成 */
  get MCP(): boolean {
    return typeof FEATURE_MCP !== 'undefined' ? FEATURE_MCP : devFallback('MCP');
  },

  /** SILK 语音转码（微信语音消息） */
  get SILK_VOICE(): boolean {
    return typeof FEATURE_SILK_VOICE !== 'undefined' ? FEATURE_SILK_VOICE : devFallback('SILK_VOICE');
  },

  /** 企业微信渠道 */
  get WECOM(): boolean {
    return typeof FEATURE_WECOM !== 'undefined' ? FEATURE_WECOM : devFallback('WECOM');
  },

  /** 飞书渠道 */
  get FEISHU(): boolean {
    return typeof FEATURE_FEISHU !== 'undefined' ? FEATURE_FEISHU : devFallback('FEISHU');
  },

  // ─── Kernel 能力 Flag ───

  /** 缓存感知微压缩 */
  get CACHED_MICROCOMPACT(): boolean {
    return typeof FEATURE_CACHED_MICROCOMPACT !== 'undefined' ? FEATURE_CACHED_MICROCOMPACT : devFallback('CACHED_MICROCOMPACT');
  },

  /** 响应式渐进压缩 */
  get REACTIVE_COMPACT(): boolean {
    return typeof FEATURE_REACTIVE_COMPACT !== 'undefined' ? FEATURE_REACTIVE_COMPACT : devFallback('REACTIVE_COMPACT');
  },

  /** Session Memory 零成本压缩 */
  get SESSION_MEMORY_COMPACT(): boolean {
    return typeof FEATURE_SESSION_MEMORY_COMPACT !== 'undefined' ? FEATURE_SESSION_MEMORY_COMPACT : devFallback('SESSION_MEMORY_COMPACT');
  },
} satisfies Record<FeatureName, boolean>;

// ─── 诊断 ─────────────────────────────────────────────────────────

/** 单个 Flag 的诊断信息 */
export interface FeatureInfo {
  readonly enabled: boolean;
  readonly desc: string;
  readonly modules: readonly string[];
}

/** 获取所有 Feature Flag 当前状态（用于诊断） */
export function getFeatureStatus(): Record<FeatureName, FeatureInfo> {
  const result = {} as Record<FeatureName, FeatureInfo>;
  for (const name of FEATURE_NAMES) {
    const meta = FEATURE_REGISTRY[name];
    result[name] = { enabled: Feature[name], desc: meta.desc, modules: meta.modules };
  }
  return result;
}
