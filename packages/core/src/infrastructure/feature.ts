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
 *     const { weixinRoutes } = await import('./channel/adapters/weixin-routes.js');
 *   }
 */

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
} as const;

/** 所有 Feature Flag 名称 */
export type FeatureName = keyof typeof Feature;

/** 获取所有 Feature Flag 当前状态（用于诊断） */
export function getFeatureStatus(): Record<FeatureName, boolean> {
  return {
    SANDBOX: Feature.SANDBOX,
    WEIXIN: Feature.WEIXIN,
    MCP: Feature.MCP,
    SILK_VOICE: Feature.SILK_VOICE,
  };
}
