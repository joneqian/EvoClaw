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
