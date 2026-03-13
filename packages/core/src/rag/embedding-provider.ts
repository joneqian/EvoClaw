/**
 * Embedding Provider — OpenAI 兼容 /v1/embeddings 调用
 *
 * 支持 OpenAI、通义千问、智谱 GLM、豆包等兼容端点。
 */

/** 默认模型维度配置 */
export const DEFAULT_EMBEDDING_MODELS: Record<string, { model: string; dimension: number }> = {
  openai: { model: 'text-embedding-3-small', dimension: 1536 },
  qwen: { model: 'text-embedding-v3', dimension: 1024 },
  glm: { model: 'embedding-3', dimension: 2048 },
};

/** Embedding Provider 配置 */
export interface EmbeddingProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
}

export class EmbeddingProvider {
  constructor(private config: EmbeddingProviderConfig) {}

  /** 生成单条文本的 embedding */
  async generate(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.config.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Embedding API 错误 (${response.status}): ${errorText}`);
    }

    const json = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    if (!json.data?.[0]?.embedding) {
      throw new Error('Embedding API 返回格式异常');
    }

    return new Float32Array(json.data[0].embedding);
  }

  /** 批量生成 embedding */
  async generateBatch(texts: string[], batchSize = 20): Promise<Float32Array[]> {
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await fetch(`${this.config.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: batch,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Embedding API 批量错误 (${response.status}): ${errorText}`);
      }

      const json = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // 按 index 排序确保顺序正确
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        results.push(new Float32Array(item.embedding));
      }
    }

    return results;
  }

  /** 获取维度 */
  get dimension(): number {
    return this.config.dimension;
  }
}

/** 工厂函数 — 根据 provider 配置创建 EmbeddingProvider */
export function createEmbeddingProvider(
  baseUrl: string,
  apiKey: string,
  providerId?: string,
  modelOverride?: string,
): EmbeddingProvider {
  const defaults = DEFAULT_EMBEDDING_MODELS[providerId ?? 'openai'] ?? DEFAULT_EMBEDDING_MODELS.openai;
  return new EmbeddingProvider({
    baseUrl,
    apiKey,
    model: modelOverride ?? defaults.model,
    dimension: defaults.dimension,
  });
}
