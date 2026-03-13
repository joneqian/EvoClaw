/** LLM Provider 配置 */
export interface ProviderConfig {
  id: string;
  name: string;
  /** API Base URL */
  baseUrl: string;
  /** API Key 引用名（Keychain service name） */
  apiKeyRef: string;
  /** 支持的模型列表 */
  models: ModelConfig[];
}

/** 模型配置 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  /** 最大上下文长度 */
  maxContextLength: number;
  /** 最大输出 tokens */
  maxOutputTokens: number;
  /** 是否支持 vision */
  supportsVision: boolean;
  /** 是否支持 tool use */
  supportsToolUse: boolean;
  /** 是否为默认模型 */
  isDefault: boolean;
}

/** 模型选择结果 */
export interface ResolvedModel {
  provider: string;
  modelId: string;
  apiKeyRef: string;
  baseUrl: string;
}
