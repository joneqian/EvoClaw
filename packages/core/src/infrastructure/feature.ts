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
  SANDBOX:    { desc: '沙箱模式（Docker 隔离执行）',    modules: ['sandbox/*'] },
  WEIXIN:     { desc: '微信个人号渠道',                  modules: ['channel/adapters/weixin*'] },
  MCP:        { desc: 'MCP 服务器集成',                  modules: ['mcp/*', 'routes/mcp*'] },
  SILK_VOICE: { desc: 'SILK 语音转码（微信语音消息）',   modules: ['channel/adapters/weixin-silk*'] },
  WECOM:      { desc: '企业微信渠道',                    modules: ['channel/adapters/wecom*'] },
  FEISHU:     { desc: '飞书渠道',                        modules: ['channel/adapters/feishu*'] },
} as const satisfies Record<string, FeatureMeta>;

/** 所有 Feature Flag 名称 */
export type FeatureName = keyof typeof FEATURE_REGISTRY;

/** 注册表中所有 Flag 名称列表（运行时可用） */
export const FEATURE_NAMES = Object.keys(FEATURE_REGISTRY) as FeatureName[];

// ─── Feature Flag 运行时查询 ─────────────────────────────────────

/**
 * 开发模式回退：从环境变量 ENABLE_{name} 读取
 * 仅当编译时常量不存在时使用（tsx watch 场景）
 */
function devFallback(name: string): boolean {
  return process.env[`ENABLE_${name}`] === 'true';
}

/**
 * Feature Flag 对象
 *
 * 每个 getter 检查编译时常量是否存在：
 * - 存在 → 直接使用（生产构建，已被 esbuild 替换为常量）
 * - 不存在 → 回退到环境变量（开发模式）
 */
export const Feature = {
  /** 沙箱模式（Docker 隔离执行） */
  get SANDBOX(): boolean {
    return typeof FEATURE_SANDBOX !== 'undefined' ? FEATURE_SANDBOX : devFallback('SANDBOX');
  },

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
} as const;

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
