import type { ProviderConfig, ModelConfig } from '@evoclaw/shared';

/** 已注册的 Provider 配置 */
const providers = new Map<string, ProviderConfig>();

/** 内置 Provider（PI 框架原生支持） */
const BUILTIN_PROVIDERS = ['openai', 'anthropic', 'google', 'groq'] as const;

/** 注册自定义 Provider（国产模型） */
export function registerProvider(config: ProviderConfig): void {
  providers.set(config.id, config);
}

/** 注销 Provider */
export function unregisterProvider(id: string): void {
  providers.delete(id);
}

/** 获取所有已注册 Provider */
export function getProviders(): ProviderConfig[] {
  return Array.from(providers.values());
}

/** 获取 Provider */
export function getProvider(id: string): ProviderConfig | undefined {
  return providers.get(id);
}

/** 检查 Provider 是否为内置 */
export function isBuiltinProvider(id: string): boolean {
  return (BUILTIN_PROVIDERS as readonly string[]).includes(id);
}

/** 更新 Provider 的模型列表（API 动态拉取后调用） */
export function updateProviderModels(
  id: string,
  models: ModelConfig[],
): boolean {
  const provider = providers.get(id);
  if (!provider) return false;
  provider.models = models;
  return true;
}

/** 注册通义千问 */
export function registerQwen(apiKeyRef: string): void {
  registerProvider({
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyRef,
    models: [
      {
        id: 'qwen-max',
        name: 'Qwen Max',
        provider: 'qwen',
        maxContextLength: 32768,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'qwen-plus',
        name: 'Qwen Plus',
        provider: 'qwen',
        maxContextLength: 131072,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
      {
        id: 'qwen-turbo',
        name: 'Qwen Turbo',
        provider: 'qwen',
        maxContextLength: 131072,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
      {
        id: 'qwen-vl-max',
        name: 'Qwen VL Max',
        provider: 'qwen',
        maxContextLength: 32768,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsToolUse: false,
        isDefault: false,
      },
    ],
  });
}

/** 注册智谱 GLM */
export function registerGLM(apiKeyRef: string): void {
  registerProvider({
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyRef,
    models: [
      {
        id: 'glm-4-plus',
        name: 'GLM-4 Plus',
        provider: 'glm',
        maxContextLength: 128000,
        maxOutputTokens: 4096,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'glm-4v-plus',
        name: 'GLM-4V Plus',
        provider: 'glm',
        maxContextLength: 8192,
        maxOutputTokens: 4096,
        supportsVision: true,
        supportsToolUse: false,
        isDefault: false,
      },
    ],
  });
}

/** 注册字节豆包 */
export function registerDoubao(apiKeyRef: string): void {
  registerProvider({
    id: 'doubao',
    name: '字节豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyRef,
    models: [
      {
        id: 'doubao-pro-32k',
        name: 'Doubao Pro 32K',
        provider: 'doubao',
        maxContextLength: 32768,
        maxOutputTokens: 4096,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'doubao-lite-32k',
        name: 'Doubao Lite 32K',
        provider: 'doubao',
        maxContextLength: 32768,
        maxOutputTokens: 4096,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
    ],
  });
}

/** 注册 DeepSeek */
export function registerDeepSeek(apiKeyRef: string): void {
  registerProvider({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyRef,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        provider: 'deepseek',
        maxContextLength: 65536,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1',
        provider: 'deepseek',
        maxContextLength: 65536,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: false,
        isDefault: false,
      },
    ],
  });
}

/** 注册 MiniMax */
export function registerMiniMax(apiKeyRef: string): void {
  registerProvider({
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKeyRef,
    models: [
      {
        id: 'MiniMax-M2.5-highspeed',
        name: 'MiniMax M2.5 Highspeed',
        provider: 'minimax',
        maxContextLength: 1048576,
        maxOutputTokens: 16384,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'MiniMax-Text-01',
        name: 'MiniMax Text 01',
        provider: 'minimax',
        maxContextLength: 1048576,
        maxOutputTokens: 16384,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
      {
        id: 'abab6.5s-chat',
        name: 'ABAB 6.5s',
        provider: 'minimax',
        maxContextLength: 245760,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
    ],
  });
}

/** 注册 Kimi/Moonshot */
export function registerKimi(apiKeyRef: string): void {
  registerProvider({
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyRef,
    models: [
      {
        id: 'moonshot-v1-128k',
        name: 'Moonshot V1 128K',
        provider: 'kimi',
        maxContextLength: 131072,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'moonshot-v1-32k',
        name: 'Moonshot V1 32K',
        provider: 'kimi',
        maxContextLength: 32768,
        maxOutputTokens: 8192,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
      {
        id: 'moonshot-v1-8k',
        name: 'Moonshot V1 8K',
        provider: 'kimi',
        maxContextLength: 8192,
        maxOutputTokens: 4096,
        supportsVision: false,
        supportsToolUse: true,
        isDefault: false,
      },
    ],
  });
}

/** 注册 OpenAI（PI 内置，此函数用于显式配置模型列表） */
export function registerOpenAI(apiKeyRef: string): void {
  registerProvider({
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyRef,
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        maxContextLength: 128000,
        maxOutputTokens: 16384,
        supportsVision: true,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'openai',
        maxContextLength: 128000,
        maxOutputTokens: 16384,
        supportsVision: true,
        supportsToolUse: true,
        isDefault: false,
      },
    ],
  });
}

/** 注册 Anthropic（PI 内置，此函数用于显式配置模型列表） */
export function registerAnthropic(apiKeyRef: string): void {
  registerProvider({
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyRef,
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        provider: 'anthropic',
        maxContextLength: 200000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsToolUse: true,
        isDefault: true,
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        provider: 'anthropic',
        maxContextLength: 200000,
        maxOutputTokens: 8192,
        supportsVision: true,
        supportsToolUse: true,
        isDefault: false,
      },
    ],
  });
}

/** 清除所有注册（测试用） */
export function clearProviders(): void {
  providers.clear();
}
