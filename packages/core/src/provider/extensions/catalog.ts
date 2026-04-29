/**
 * Provider Catalog — 内置 provider + 模型清单的单一数据源
 *
 * 添加新模型: 在对应 provider 的 models 数组追加一条 ModelDefinition
 * 添加新 provider: 在 PROVIDER_CATALOG 追加一项 ProviderDefinition
 *
 * 数据维护规范:
 * - 每个 provider 段落顶部注明官方文档 URL + 最近核对日期
 * - 每个模型尽量按"最新 → 最旧"顺序排列
 * - isDefault 标记当前推荐的旗舰模型（每 provider 仅一个）
 * - thinkingLevels 必含 'off'，按升序排列；defaultThinkLevel 必须在 thinkingLevels 中
 * - 不在此处做 forward-compat 模板配置（由 forward-compat.ts 算法自动处理）
 *
 * 思考默认值策略（面向非技术企业用户，2026-04-29 调整）:
 * - adaptive 可用 → 'adaptive'（Claude 4.7/4.6：模型自适应，最优 UX）
 * - 国产旗舰（GLM/Kimi/Qwen/Doubao/MiniMax）→ 'high'（用户选国产模型通常预期"用满"）
 * - 海外通用（GPT-5.x / Claude 4.5 / DeepSeek）→ 'low'（轻量思考、低延迟）
 * - 纯推理模型（o-series）→ 'high'（用户选它就是要深推理）
 * - 无思考模型 → undefined（auto 等价于 off）
 */

import type { ThinkLevel } from '@evoclaw/shared';
import type { ProviderDefinition } from './types.js';

// ─── Thinking 等级预设（避免每条模型重复同一数组） ───
const THINK_BASIC: readonly ThinkLevel[] = ['off', 'minimal', 'low', 'medium', 'high'] as const;
const THINK_BINARY: readonly ThinkLevel[] = ['off', 'high'] as const;
const THINK_CLAUDE_46: readonly ThinkLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'adaptive'] as const;
const THINK_CLAUDE_47: readonly ThinkLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const;

export const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Anthropic — https://docs.anthropic.com/en/docs/about-claude/models
  // Last verified: 2026-04-29
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic-messages',
    models: [
      // 4.7 系列（最新旗舰，2026-Q2 发布；新 tokenizer，1M context，全 8 档思考）
      { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', contextWindow: 1000000, maxTokens: 32000, maxOutputLimit: 128000, input: ['text', 'image'], thinkingLevels: THINK_CLAUDE_47, defaultThinkLevel: 'adaptive', isDefault: true },
      // 4.6 系列（前代旗舰，支持 adaptive thinking）
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 1000000, maxTokens: 128000, maxOutputLimit: 128000, input: ['text', 'image'], thinkingLevels: THINK_CLAUDE_46, defaultThinkLevel: 'adaptive' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxTokens: 128000, maxOutputLimit: 128000, input: ['text', 'image'], thinkingLevels: THINK_CLAUDE_46, defaultThinkLevel: 'adaptive' },
      // 4.5 系列（仅 enabled thinking 固定预算；4 系列 2026-06-15 退役）
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextWindow: 200000, maxTokens: 16384, maxOutputLimit: 64000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 16384, maxOutputLimit: 64000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 16384, maxOutputLimit: 64000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // OpenAI — https://platform.openai.com/docs/models
  // Last verified: 2026-04-29
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'openai',
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    models: [
      // GPT-5.5 系列（最新旗舰，2026-04-24 GA）
      { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low', isDefault: true },
      { id: 'gpt-5.5-pro', name: 'GPT-5.5 Pro', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      // GPT-5.4 系列（前代旗舰）
      { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400000, maxTokens: 128000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
      // GPT-4.1 系列（无 thinking）
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
      // o-series 推理模型
      // o-series 是纯推理特化模型，用户选这些就是要深推理，保持 high
      { id: 'o3', name: 'o3', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'o4-mini', name: 'o4 Mini', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      // GPT-4o 系列（旧版，无 thinking）
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
      // Embedding
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', contextWindow: 8191, maxTokens: 0, input: ['text'], toolUse: false, dimension: 1536 },
      { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', contextWindow: 8191, maxTokens: 0, input: ['text'], toolUse: false, dimension: 3072 },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DeepSeek — https://api-docs.deepseek.com/quick_start/pricing
  // Last verified: 2026-04-29
  // 走 Anthropic 协议端点（原生支持 prompt caching，降低成本）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/anthropic',
    api: 'anthropic-messages',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1000000, maxTokens: 384000, maxOutputLimit: 384000, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low', isDefault: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1000000, maxTokens: 384000, maxOutputLimit: 384000, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'low' },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Kimi (Moonshot) — https://platform.moonshot.ai/docs
  // Last verified: 2026-04-29
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    api: 'openai-completions',
    models: [
      // K2.6（最新旗舰，编码焦点，长程任务，二元 thinking）
      // Source: https://www.kimi.com/blog/kimi-k2-6
      { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262144, maxTokens: 262144, input: ['text'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high', isDefault: true },
      // K2.5（前代旗舰，多模态，无 thinking）
      { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262144, maxTokens: 262144, input: ['text', 'image'] },
      // K2 推理系列（二元 on/off）
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', contextWindow: 262144, maxTokens: 262144, input: ['text'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high' },
      { id: 'kimi-k2-thinking-turbo', name: 'Kimi K2 Thinking Turbo', contextWindow: 262144, maxTokens: 262144, input: ['text'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high' },
      // K2 快速（无 thinking）
      { id: 'kimi-k2-turbo', name: 'Kimi K2 Turbo', contextWindow: 256000, maxTokens: 16384, input: ['text'] },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 智谱 GLM — https://docs.bigmodel.cn / https://docs.z.ai
  // Last verified: 2026-04-29
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'glm',
    name: '智谱 GLM',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions',
    models: [
      // GLM-5.1 系列（最新旗舰，2026-Q2 GA，长程任务专精）
      // Source: https://z.ai/blog/glm-5.1
      { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 204800, maxTokens: 131072, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high', isDefault: true },
      // GLM-5 系列
      { id: 'glm-5', name: 'GLM-5', contextWindow: 202800, maxTokens: 131100, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-5-turbo', name: 'GLM-5 Turbo', contextWindow: 202800, maxTokens: 131100, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      // GLM-4.7 系列
      { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 204800, maxTokens: 131072, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', contextWindow: 200000, maxTokens: 131072, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-4.7-flashx', name: 'GLM-4.7 FlashX', contextWindow: 200000, maxTokens: 128000, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      // GLM-4.6 系列
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 204800, maxTokens: 131072, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-4.6v', name: 'GLM-4.6V', contextWindow: 128000, maxTokens: 32768, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      // GLM-4.5 系列
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 131072, maxTokens: 98304, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextWindow: 131072, maxTokens: 98304, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash', contextWindow: 131072, maxTokens: 98304, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      { id: 'glm-4.5v', name: 'GLM-4.5V', contextWindow: 64000, maxTokens: 16384, input: ['text', 'image'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      // Embedding
      { id: 'embedding-3', name: 'Embedding 3', contextWindow: 8192, maxTokens: 0, input: ['text'], toolUse: false, dimension: 2048 },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 通义千问 Qwen — https://help.aliyun.com/zh/model-studio/
  // Last verified: 2026-04-29
  // qwen3+ 系列通过 enable_thinking 参数支持二元思考模式
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'qwen',
    name: '通义千问',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions',
    models: [
      // Qwen3.6 系列（最新旗舰，2026-04 发布；qwen3.6-plus 多模态）
      // Source: https://help.aliyun.com/zh/model-studio/vision
      { id: 'qwen3.6-plus', name: 'Qwen3.6 Plus', contextWindow: 1000000, maxTokens: 65536, input: ['text', 'image'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high', isDefault: true },
      { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high' },
      // Qwen3.5 系列
      { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: 1000000, maxTokens: 65536, input: ['text', 'image'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high' },
      { id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', contextWindow: 1000000, maxTokens: 65536, input: ['text', 'image'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high' },
      // Qwen3 系列
      { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144, maxTokens: 65536, input: ['text'], thinkingLevels: THINK_BINARY, defaultThinkLevel: 'high' },
      // Qwen3 Coder 系列（编码优化，无思考模式）
      { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: 1000000, maxTokens: 65536, input: ['text'] },
      { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', contextWindow: 262144, maxTokens: 65536, input: ['text'] },
      // Embedding
      { id: 'text-embedding-v4', name: 'Text Embedding V4', contextWindow: 8192, maxTokens: 0, input: ['text'], toolUse: false, dimension: 1024 },
      { id: 'text-embedding-v3', name: 'Text Embedding V3', contextWindow: 8192, maxTokens: 0, input: ['text'], toolUse: false, dimension: 1024 },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 字节豆包 Doubao — https://www.volcengine.com/docs/82379/
  // Last verified: 2026-04-29
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'doubao',
    name: '字节豆包',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    api: 'openai-completions',
    models: [
      // Seed 2.0 系列（最新旗舰）
      { id: 'doubao-seed-2-0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 256000, maxTokens: 16384, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high', isDefault: true },
      { id: 'doubao-seed-code', name: 'Doubao Seed Code', contextWindow: 256000, maxTokens: 16384, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
      // Seed 1.8（多模态，无 thinking）
      { id: 'doubao-seed-1-8', name: 'Doubao Seed 1.8', contextWindow: 256000, maxTokens: 16384, input: ['text', 'image'] },
      // 1.5 系列
      { id: 'doubao-1-5-pro-256k', name: 'Doubao 1.5 Pro 256K', contextWindow: 256000, maxTokens: 12288, input: ['text'] },
      { id: 'doubao-1-5-pro-32k', name: 'Doubao 1.5 Pro 32K', contextWindow: 32000, maxTokens: 12288, input: ['text'] },
      // 多模态
      { id: 'doubao-1-5-vision-pro', name: 'Doubao 1.5 Vision Pro', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MiniMax — https://platform.minimax.io/docs
  // Last verified: 2026-04-29
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'minimax',
    name: 'MiniMax',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 204800, maxTokens: 131072, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high', isDefault: true },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', contextWindow: 204800, maxTokens: 131072, input: ['text'], thinkingLevels: THINK_BASIC, defaultThinkLevel: 'high' },
    ],
  },
];
