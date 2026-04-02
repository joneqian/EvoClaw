/**
 * Feature Flag 编译时常量声明
 *
 * 这些全局常量由 esbuild `define` 在构建时注入。
 * 生产构建中被替换为 true/false 常量，配合 tree shake 实现死代码消除。
 * 开发模式下（tsx watch）这些全局变量不存在，feature.ts 会回退到环境变量。
 *
 * 添加新 Feature Flag 步骤：
 * 1. 在此文件添加 declare const
 * 2. 在 build.ts 的 featureFlags 添加对应 define
 * 3. 在 feature.ts 的 Feature 对象添加 getter
 */

/** 沙箱模式（Docker 隔离执行） */
declare const FEATURE_SANDBOX: boolean;

/** 微信个人号渠道 */
declare const FEATURE_WEIXIN: boolean;

/** MCP 服务器集成 */
declare const FEATURE_MCP: boolean;

/** SILK 语音转码（微信语音消息） */
declare const FEATURE_SILK_VOICE: boolean;
