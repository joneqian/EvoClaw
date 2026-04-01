/**
 * 配置路由 — evo_claw.json 管理
 */

import { Hono } from 'hono';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { EvoClawConfig, ProviderEntry } from '@evoclaw/shared';
import { BRAND } from '@evoclaw/shared';
import { registerProvider } from '../provider/provider-registry.js';

/** 已知 Provider 的友好名称 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  glm: '智谱 GLM',
  doubao: '字节豆包',
  minimax: 'MiniMax',
  kimi: 'Kimi (Moonshot)',
};

/** 将 evo_claw.json 中的 Provider 同步到内存注册表 */
function syncProviderToRegistry(id: string, entry: ProviderEntry): void {
  registerProvider({
    id,
    name: PROVIDER_DISPLAY_NAMES[id] ?? id,
    baseUrl: entry.baseUrl,
    apiKeyRef: entry.apiKey,
    models: entry.models.map((m) => ({
      id: m.id,
      name: m.name,
      provider: id,
      maxContextLength: m.contextWindow ?? 128000,
      maxOutputTokens: m.maxTokens ?? 4096,
      supportsVision: m.input?.includes('image') ?? false,
      supportsToolUse: true,
      isDefault: false,
    })),
  });
}

/** 创建配置路由 */
export function createConfigRoutes(configManager: ConfigManager): Hono {
  const app = new Hono();

  /** GET / — 获取完整配置（隐藏 apiKey） */
  app.get('/', (c) => {
    const config = configManager.getConfig();
    const validation = configManager.validate();

    // 隐藏 API Key
    const safeConfig = structuredClone(config);
    if (safeConfig.models?.providers) {
      for (const entry of Object.values(safeConfig.models.providers)) {
        if (entry.apiKey) {
          entry.apiKey = '***';
        }
      }
    }

    return c.json({ config: safeConfig, validation });
  });

  /** PUT / — 更新完整配置 */
  app.put('/', async (c) => {
    const body = await c.req.json<EvoClawConfig>();
    configManager.updateConfig(body);
    // 同步所有 Provider 到内存注册表
    if (body.models?.providers) {
      for (const [id, entry] of Object.entries(body.models.providers)) {
        syncProviderToRegistry(id, entry);
      }
    }
    const validation = configManager.validate();
    return c.json({ success: true, validation });
  });

  /** GET /validate — 校验配置完整性 */
  app.get('/validate', (c) => {
    return c.json(configManager.validate());
  });

  /** POST /reload — 从磁盘重新加载配置 */
  app.post('/reload', (c) => {
    configManager.reload();
    const validation = configManager.validate();
    return c.json({ success: true, validation });
  });

  /** PUT /provider/:id — 添加/更新 Provider */
  app.put('/provider/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<ProviderEntry>();

    if (!body.baseUrl || !body.api) {
      return c.json({ error: '需要 baseUrl 和 api' }, 400);
    }

    // apiKey 为特殊值时保持原值
    const existing = configManager.getProvider(id);
    if (body.apiKey === '___KEEP___' && existing) {
      body.apiKey = existing.apiKey;
    }

    configManager.setProvider(id, body);
    syncProviderToRegistry(id, body);
    return c.json({ success: true });
  });

  /** DELETE /provider/:id — 删除 Provider */
  app.delete('/provider/:id', (c) => {
    const id = c.req.param('id');
    configManager.removeProvider(id);
    return c.json({ success: true });
  });

  /** GET /env-vars — 获取环境变量列表（值脱敏） */
  app.get('/env-vars', (c) => {
    const config = configManager.getConfig();
    // 品牌默认环境变量（优先级最低） + 用户配置覆盖
    const merged: Record<string, string> = { ...(BRAND.defaultEnv ?? {}), ...(config.envVars ?? {}) };
    // 向后兼容：合并旧 services.brave.apiKey
    if (config.services?.brave?.apiKey && !merged['BRAVE_API_KEY']) {
      merged['BRAVE_API_KEY'] = config.services.brave.apiKey;
    }
    const masked = Object.entries(merged).map(([key, value]) => ({
      key,
      maskedValue: value ? value.slice(0, 4) + '***' + value.slice(-4) : '',
      configured: !!value,
    }));
    return c.json({ envVars: masked });
  });

  /** GET /env-vars/:key — 获取单个环境变量明文值（编辑时使用） */
  app.get('/env-vars/:key', (c) => {
    const key = c.req.param('key');
    const config = configManager.getConfig();
    const merged: Record<string, string> = { ...(BRAND.defaultEnv ?? {}), ...(config.envVars ?? {}) };
    if (config.services?.brave?.apiKey && !merged['BRAVE_API_KEY']) {
      merged['BRAVE_API_KEY'] = config.services.brave.apiKey;
    }
    const value = merged[key];
    if (value === undefined) return c.json({ error: '变量不存在' }, 404);
    return c.json({ key, value });
  });

  /** PUT /env-vars — 批量更新环境变量 */
  app.put('/env-vars', async (c) => {
    const body = await c.req.json<{ envVars: Record<string, string> }>();
    const config = configManager.getConfig();
    config.envVars = body.envVars;
    // 向后兼容：同步 BRAVE_API_KEY 到旧 services 结构
    if (body.envVars['BRAVE_API_KEY'] !== undefined) {
      config.services = config.services ?? {};
      config.services.brave = { apiKey: body.envVars['BRAVE_API_KEY'] };
    }
    configManager.updateConfig(config);
    // 立即注入到 process.env
    for (const [key, value] of Object.entries(body.envVars)) {
      if (value) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    }
    return c.json({ success: true });
  });

  return app;
}
