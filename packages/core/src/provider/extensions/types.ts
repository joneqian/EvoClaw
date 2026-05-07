/**
 * Model Extensions 类型定义
 * 每个 provider 预设一组经过验证的 Agent 可用模型
 */

import type { ThinkLevel } from '@evoclaw/shared';

/** 模型输入模态 */
export type ModelInputModality = 'text' | 'image';

/** API 协议 */
export type ModelApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google';

/** 单个模型定义 */
export interface ModelDefinition {
  /** 模型 ID（如 "qwen-max", "gpt-4o"） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 最大上下文窗口 (tokens) */
  contextWindow: number;
  /** 默认输出 tokens（API 请求中的 max_tokens） */
  maxTokens: number;
  /** 模型最大输出能力上限（用于 thinking budget 计算，省略时等于 maxTokens） */
  maxOutputLimit?: number;
  /** 支持的输入模态 */
  input: ModelInputModality[];
  /**
   * 模型支持的思考等级（升序排列，必含 'off'；undefined = 不支持任何形式的思考）
   *
   * 例：
   * - 普通推理模型: ['off', 'minimal', 'low', 'medium', 'high']
   * - Anthropic 4.6+: 上述 + 'adaptive'
   * - Anthropic 4.7: 上述 + 'xhigh' + 'max'
   * - Kimi 二元开关: ['off', 'high']
   */
  thinkingLevels?: readonly ThinkLevel[];
  /**
   * auto 模式下的默认思考等级（必须是 thinkingLevels 之一）
   *
   * undefined = auto 模式下不思考（等价于 'off'）
   */
  defaultThinkLevel?: ThinkLevel;
  /** 是否支持工具调用（默认 true） */
  toolUse?: boolean;
  /** 是否为该 provider 的默认推荐模型 */
  isDefault?: boolean;
  /** Embedding 向量维度（仅 embedding 模型，有此字段即为 embedding 模型） */
  dimension?: number;
}

/**
 * Provider 认证策略（声明式 ProviderProfile，参考 Hermes 20a4f79ed）
 *
 * 把 buildAuthHeaders() 里的 if/else 分支数据化，让新 provider 只需在 catalog 声明
 * authStrategy 即可工作，无需改 model-fetcher.ts 主链路。
 *
 * - 'anthropic'   : `x-api-key` + `anthropic-version` 双 header（Claude 原生协议）
 * - 'bearer'      : `Authorization: Bearer ${apiKey}`（OpenAI 兼容，绝大多数 provider 默认）
 * - 'glm-jwt'     : 智谱 GLM `{id}.{secret}` 格式 → 生成 5 分钟 JWT 后 Bearer
 * - 'custom'      : 任意自定义 header 函数；为日后接入特殊网关 / 厂商保留扩展点
 *
 * 决策流程（见 model-fetcher.buildAuthHeaders）：
 *   1) catalog 中显式声明 authStrategy → 直接用
 *   2) 否则按 baseUrl 兜底嗅探（向后兼容老配置：anthropic.com / bigmodel.cn）
 *   3) 最终默认 → 'bearer'
 */
export type AuthStrategy =
  | 'anthropic'
  | 'bearer'
  | 'glm-jwt'
  | {
      kind: 'custom';
      /**
       * 自定义 header 构造器
       *
       * 收到原始 apiKey，返回需要塞到请求 header 里的键值对（不含 Content-Type，
       * model-fetcher 会自动补）。函数应保持纯净（无副作用 / 不抛异常）。
       */
      customHeaders: (apiKey: string) => Record<string, string>;
    };

/** Provider 定义（预设） */
export interface ProviderDefinition {
  /** Provider ID（如 "qwen", "openai"） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 默认 API 基础 URL */
  defaultBaseUrl: string;
  /** API 协议 */
  api: ModelApi;
  /** 预设模型列表（仅 Agent 可用的文本/多模态模型） */
  models: ModelDefinition[];
  /**
   * 认证策略（可选）
   *
   * 未声明时 model-fetcher 按 baseUrl 嗅探后兜底走 'bearer'。新增 provider
   * 若需要特殊认证（如自定义 header），在 catalog 直接声明 authStrategy 即可，
   * 不必改 model-fetcher.ts。
   */
  authStrategy?: AuthStrategy;
}
