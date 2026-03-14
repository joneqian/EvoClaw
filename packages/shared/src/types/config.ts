/** evo_claw.json 配置文件结构 */
export interface EvoClawConfig {
  /** 已配置的 Provider 列表 */
  providers: Record<string, ProviderEntry>;
  /** 模型选择 */
  models: ModelSelection;
}

/** Provider 配置条目 */
export interface ProviderEntry {
  name: string;
  baseUrl: string;
  apiKey: string;
}

/** 模型选择配置 */
export interface ModelSelection {
  /** 默认对话模型 */
  default: ModelRef;
  /** 向量 Embedding 模型 */
  embedding?: EmbeddingModelRef;
}

/** 模型引用 */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/** Embedding 模型引用 */
export interface EmbeddingModelRef extends ModelRef {
  dimension: number;
}

/** 配置校验结果 */
export interface ConfigValidation {
  valid: boolean;
  missing: string[];
}
