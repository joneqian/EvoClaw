/**
 * 模型定价表 — 每百万 Token 的价格（美元）
 *
 * 参考 Claude Code 的 modelCost.ts 和各 Provider 官方定价
 * 单位: USD per 1M tokens
 */

export interface ModelPricing {
  /** 输入 token 价格 (USD/1M) */
  input: number;
  /** 输出 token 价格 (USD/1M) */
  output: number;
  /** Cache 写入价格 (USD/1M)，无则等于 input */
  cacheWrite?: number;
  /** Cache 读取价格 (USD/1M)，无则等于 input */
  cacheRead?: number;
}

/** USD → 人民币汇率（定期更新） */
const USD_TO_CNY = 7.25;

/**
 * 定价表：key = 模型 ID 前缀匹配
 *
 * 匹配规则: 最长前缀优先
 * 例如 "claude-sonnet-4-6" 先匹配 "claude-sonnet-4-6" 再匹配 "claude-sonnet"
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ─── Anthropic ───
  'claude-opus-4-6':       { input: 15,  output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-5':       { input: 5,   output: 25,  cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-sonnet-4-6':     { input: 3,   output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-sonnet-4-5':     { input: 3,   output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5':      { input: 1,   output: 5,   cacheWrite: 1.25,  cacheRead: 0.10 },
  'claude-3-5-sonnet':     { input: 3,   output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-3-5-haiku':      { input: 0.80, output: 4,  cacheWrite: 1.00,  cacheRead: 0.08 },
  'claude-3-opus':         { input: 15,  output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },

  // ─── OpenAI ───
  'gpt-4.1':               { input: 2,    output: 8 },
  'gpt-4.1-mini':          { input: 0.40, output: 1.60 },
  'gpt-4.1-nano':          { input: 0.10, output: 0.40 },
  'gpt-4o':                { input: 2.50, output: 10 },
  'gpt-4o-mini':           { input: 0.15, output: 0.60 },
  'o3':                    { input: 2,    output: 8 },
  'o3-mini':               { input: 1.10, output: 4.40 },
  'o4-mini':               { input: 1.10, output: 4.40 },

  // ─── Google ───
  'gemini-2.5-pro':        { input: 1.25, output: 10 },
  'gemini-2.5-flash':      { input: 0.15, output: 0.60 },
  'gemini-2.0-flash':      { input: 0.10, output: 0.40 },

  // ─── 国产模型（人民币定价，已转换为 USD） ───
  // Qwen (通义千问)
  'qwen-max':              { input: 2.76, output: 11.03 },  // ¥20/¥80 per 1M
  'qwen-plus':             { input: 0.55, output: 2.07 },   // ¥4/¥15 per 1M
  'qwen-turbo':            { input: 0.14, output: 0.41 },   // ¥1/¥3 per 1M
  'qwen3-235b':            { input: 5.52, output: 22.07 },  // ¥40/¥160 per 1M

  // GLM (智谱)
  'glm-4-plus':            { input: 0.69, output: 0.69 },   // ¥5/¥5 per 1M
  'glm-4':                 { input: 1.38, output: 1.38 },   // ¥10/¥10 per 1M
  'glm-4-flash':           { input: 0,    output: 0 },      // 免费

  // DeepSeek
  'deepseek-chat':         { input: 0.14, output: 0.28 },   // ¥1/¥2 per 1M
  'deepseek-reasoner':     { input: 0.55, output: 2.21 },   // ¥4/¥16 per 1M

  // Doubao (豆包)
  'doubao-pro-256k':       { input: 0.69, output: 1.24 },   // ¥5/¥9 per 1M
  'doubao-lite-128k':      { input: 0.04, output: 0.14 },   // ¥0.3/¥1 per 1M
};

/**
 * 查找模型定价（最长前缀匹配）
 *
 * 匹配策略: 尝试完整 ID，然后逐步移除后缀，直到找到匹配
 * 例如 "claude-sonnet-4-6-20260514" → "claude-sonnet-4-6"
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  // 精确匹配
  if (PRICING_TABLE[modelId]) return PRICING_TABLE[modelId]!;

  // 前缀匹配（最长优先）
  let bestMatch: ModelPricing | null = null;
  let bestLen = 0;
  for (const [prefix, pricing] of Object.entries(PRICING_TABLE)) {
    if (modelId.startsWith(prefix) && prefix.length > bestLen) {
      bestMatch = pricing;
      bestLen = prefix.length;
    }
  }
  return bestMatch;
}

/**
 * 计算一次 API 调用的成本（千分之一分人民币）
 *
 * 使用千分之一分作为最小单位，避免浮点精度问题。
 * 1 分 = 1000 milli
 * 1 元 = 100 分 = 100,000 milli
 */
export function calculateCostMilli(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const pricing = getModelPricing(modelId);
  if (!pricing) return 0;

  // 1. 计算 USD 成本（per token）
  //    pricing.input 是 USD per 1M tokens → 除以 1_000_000
  const inputCostUsd = (inputTokens * pricing.input) / 1_000_000;
  const outputCostUsd = (outputTokens * pricing.output) / 1_000_000;
  const cacheWriteCostUsd = cacheWriteTokens * (pricing.cacheWrite ?? pricing.input) / 1_000_000;
  const cacheReadCostUsd = cacheReadTokens * (pricing.cacheRead ?? pricing.input) / 1_000_000;

  const totalUsd = inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd;

  // 2. 转换为千分之一分人民币
  //    1 USD = USD_TO_CNY 元 = USD_TO_CNY × 100 分 = USD_TO_CNY × 100_000 milli
  return Math.round(totalUsd * USD_TO_CNY * 100_000);
}

/**
 * 将千分之一分格式化为可读字符串
 *
 * 例: 15000 → "¥0.15", 150000 → "¥1.50", 500 → "¥0.005"
 */
export function formatCostMilli(milli: number): string {
  const yuan = milli / 100_000;
  if (yuan >= 1) return `¥${yuan.toFixed(2)}`;
  if (yuan >= 0.01) return `¥${yuan.toFixed(3)}`;
  return `¥${yuan.toFixed(4)}`;
}
