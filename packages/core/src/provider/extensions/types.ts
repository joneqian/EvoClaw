/**
 * Model Extensions 类型定义
 * 每个 provider 预设一组经过验证的 Agent 可用模型
 */

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
  /** 最大输出 tokens */
  maxTokens: number;
  /** 支持的输入模态 */
  input: ModelInputModality[];
  /** 是否支持 thinking/reasoning（默认 false） */
  reasoning?: boolean;
  /** 是否支持工具调用（默认 true） */
  toolUse?: boolean;
  /** 是否为该 provider 的默认推荐模型 */
  isDefault?: boolean;
  /** Embedding 向量维度（仅 embedding 模型，有此字段即为 embedding 模型） */
  dimension?: number;
}

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
}
