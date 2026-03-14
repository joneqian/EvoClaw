/**
 * 配置路由 — evo_claw.json 管理
 */

import { Hono } from 'hono';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { EvoClawConfig, ProviderEntry } from '@evoclaw/shared';

/** 创建配置路由 */
export function createConfigRoutes(configManager: ConfigManager): Hono {
  const app = new Hono();

  /** GET / — 获取完整配置（隐藏 apiKey） */
  app.get('/', (c) => {
    const config = configManager.getConfig();
    const validation = configManager.validate();

    // 隐藏 API Key，仅返回是否已配置
    const safeProviders: Record<string, { name: string; baseUrl: string; hasApiKey: boolean }> = {};
    for (const [id, entry] of Object.entries(config.providers)) {
      safeProviders[id] = {
        name: entry.name,
        baseUrl: entry.baseUrl,
        hasApiKey: !!entry.apiKey,
      };
    }

    return c.json({
      providers: safeProviders,
      models: config.models,
      validation,
    });
  });

  /** PUT / — 更新完整配置 */
  app.put('/', async (c) => {
    const body = await c.req.json<EvoClawConfig>();

    if (!body.providers || !body.models) {
      return c.json({ error: '配置格式不完整，需要 providers 和 models 字段' }, 400);
    }

    configManager.updateConfig(body);
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

  /** GET /provider/:id — 获取单个 Provider（隐藏 apiKey） */
  app.get('/provider/:id', (c) => {
    const id = c.req.param('id');
    const entry = configManager.getProvider(id);
    if (!entry) {
      return c.json({ error: 'Provider not found' }, 404);
    }
    return c.json({
      id,
      name: entry.name,
      baseUrl: entry.baseUrl,
      hasApiKey: !!entry.apiKey,
    });
  });

  /** PUT /provider/:id — 添加/更新 Provider */
  app.put('/provider/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<ProviderEntry>();

    if (!body.name || !body.baseUrl) {
      return c.json({ error: '需要 name 和 baseUrl' }, 400);
    }

    configManager.setProvider(id, body);
    return c.json({ success: true });
  });

  /** DELETE /provider/:id — 删除 Provider */
  app.delete('/provider/:id', (c) => {
    const id = c.req.param('id');
    configManager.removeProvider(id);
    return c.json({ success: true });
  });

  return app;
}
