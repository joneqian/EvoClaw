/** evo_claw.json 配置文件结构 */
export interface EvoClawConfig {
  models?: ModelsConfig;
  /** 外部服务配置 */
  services?: {
    /** Brave Search API */
    brave?: { apiKey: string };
  };
}

/** 模型配置 */
export interface ModelsConfig {
  /** 默认对话模型，格式: "providerId/modelId" */
  default?: string;
  /** 默认 Embedding 模型，格式: "providerId/modelId" */
  embedding?: string;
  /** Provider 配置 */
  providers?: Record<string, ProviderEntry>;
}

/** Provider 配置条目 */
export interface ProviderEntry {
  baseUrl: string;
  apiKey: string;
  /** API 协议 */
  api: ApiProtocol;
  /** 模型列表 */
  models: ModelEntry[];
}

/** 支持的 API 协议 */
export type ApiProtocol = 'openai-completions' | 'anthropic-messages';

/** 模型条目 */
export interface ModelEntry {
  id: string;
  name: string;
  /** 是否支持推理/思考 */
  reasoning?: boolean;
  /** 支持的输入类型 */
  input?: string[];
  /** 费用信息 */
  cost?: ModelCost;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** Embedding 维度（仅 Embedding 模型） */
  dimension?: number;
}

/** 模型费用 */
export interface ModelCost {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** 模型引用解析结果 */
export interface ModelReference {
  provider: string;
  modelId: string;
}

/** 配置校验结果 */
export interface ConfigValidation {
  valid: boolean;
  missing: string[];
  /** 非致命警告（如 embedding 配置不完整），不影响 valid */
  warnings?: string[];
}

/** 解析 "providerId/modelId" 格式的模型引用 */
export function parseModelRef(ref: string): ModelReference | null {
  const slashIdx = ref.indexOf('/');
  if (slashIdx <= 0 || slashIdx === ref.length - 1) return null;
  return {
    provider: ref.slice(0, slashIdx),
    modelId: ref.slice(slashIdx + 1),
  };
}
