import type { ProviderConfig } from '@evoclaw/shared';

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

/** 注册通义千问 */
export function registerQwen(apiKeyRef: string): void {
  registerProvider({
    id: 'qwen',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyRef,
    models: [
      { id: 'qwen-max', name: 'Qwen Max', provider: 'qwen', maxContextLength: 32768, maxOutputTokens: 8192, supportsVision: false, supportsToolUse: true, isDefault: true },
      { id: 'qwen-plus', name: 'Qwen Plus', provider: 'qwen', maxContextLength: 131072, maxOutputTokens: 8192, supportsVision: false, supportsToolUse: true, isDefault: false },
      { id: 'qwen-turbo', name: 'Qwen Turbo', provider: 'qwen', maxContextLength: 131072, maxOutputTokens: 8192, supportsVision: false, supportsToolUse: true, isDefault: false },
      { id: 'qwen-vl-max', name: 'Qwen VL Max', provider: 'qwen', maxContextLength: 32768, maxOutputTokens: 4096, supportsVision: true, supportsToolUse: false, isDefault: false },
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
      { id: 'glm-4-plus', name: 'GLM-4 Plus', provider: 'glm', maxContextLength: 128000, maxOutputTokens: 4096, supportsVision: false, supportsToolUse: true, isDefault: true },
      { id: 'glm-4v-plus', name: 'GLM-4V Plus', provider: 'glm', maxContextLength: 8192, maxOutputTokens: 4096, supportsVision: true, supportsToolUse: false, isDefault: false },
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
      { id: 'doubao-pro-32k', name: 'Doubao Pro 32K', provider: 'doubao', maxContextLength: 32768, maxOutputTokens: 4096, supportsVision: false, supportsToolUse: true, isDefault: true },
      { id: 'doubao-lite-32k', name: 'Doubao Lite 32K', provider: 'doubao', maxContextLength: 32768, maxOutputTokens: 4096, supportsVision: false, supportsToolUse: true, isDefault: false },
    ],
  });
}

/** 清除所有注册（测试用） */
export function clearProviders(): void {
  providers.clear();
}
