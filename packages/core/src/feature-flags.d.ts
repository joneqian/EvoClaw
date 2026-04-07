/**
 * Feature Flag 编译时常量声明
 *
 * 这些全局常量由 esbuild `define` 在构建时注入。
 * 生产构建中被替换为 true/false 常量，配合 tree shake 实现死代码消除。
 * 开发模式下（tsx watch）这些全局变量不存在，feature.ts 会回退到环境变量。
 *
 * 必须与 FEATURE_REGISTRY (infrastructure/feature.ts) 保持同步。
 * CI 脚本 scripts/check-feature-flags.ts 校验一致性。
 */

/** 沙箱模式（Docker 隔离执行） */
declare const FEATURE_SANDBOX: boolean;

/** 微信个人号渠道 */
declare const FEATURE_WEIXIN: boolean;

/** MCP 服务器集成 */
declare const FEATURE_MCP: boolean;

/** SILK 语音转码（微信语音消息） */
declare const FEATURE_SILK_VOICE: boolean;

/** 企业微信渠道 */
declare const FEATURE_WECOM: boolean;

/** 飞书渠道 */
declare const FEATURE_FEISHU: boolean;
