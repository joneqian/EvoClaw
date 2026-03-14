/**
 * Provider 管理路由 — LLM Provider 配置与测试
 */

import { Hono } from 'hono';
import {
  getProviders,
  getProvider,
  registerProvider,
  unregisterProvider,
  updateProviderModels,
} from '../provider/provider-registry.js';
import { fetchModelsFromApi } from '../provider/model-fetcher.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ProviderConfig } from '@evoclaw/shared';

/** 创建 Provider 路由 */
export function createProviderRoutes(db: SqliteStore, configManager?: ConfigManager): Hono {
  const app = new Hono();

  /** GET / — 列出所有已注册 Provider */
  app.get('/', (c) => {
    const providers = getProviders();
    // 隐藏 apiKeyRef 细节，仅返回是否已配置
    const result = providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      hasApiKey: !!p.apiKeyRef,
      models: p.models,
    }));
    return c.json({ providers: result });
  });

  /** GET /:id — 获取单个 Provider */
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const provider = getProvider(id);
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }
    return c.json({
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        hasApiKey: !!provider.apiKeyRef,
        models: provider.models,
      },
    });
  });

  /** PUT /:id — 注册/更新 Provider 配置 */
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name: string;
      baseUrl: string;
      apiKeyRef: string;
      models?: ProviderConfig['models'];
    }>();

    const existing = getProvider(id);

    registerProvider({
      id,
      name: body.name,
      baseUrl: body.baseUrl,
      apiKeyRef: body.apiKeyRef,
      models: body.models ?? existing?.models ?? [],
    });

    // 持久化到 model_configs 表
    const now = new Date().toISOString();
    const existingRow = db.get<{ id: string }>(
      'SELECT id FROM model_configs WHERE provider = ?',
      id,
    );

    if (existingRow) {
      db.run(
        `UPDATE model_configs SET api_key_ref = ?, config_json = ? WHERE provider = ?`,
        body.apiKeyRef,
        JSON.stringify({ name: body.name, baseUrl: body.baseUrl, models: body.models ?? [] }),
        id,
      );
    } else {
      const { randomUUID } = await import('node:crypto');
      db.run(
        `INSERT INTO model_configs (id, provider, model_id, api_key_ref, config_json, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        randomUUID(),
        id,
        body.models?.[0]?.id ?? 'default',
        body.apiKeyRef,
        JSON.stringify({ name: body.name, baseUrl: body.baseUrl, models: body.models ?? [] }),
        now,
      );
    }

    return c.json({ success: true });
  });

  /** DELETE /:id — 注销 Provider */
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    unregisterProvider(id);
    db.run('DELETE FROM model_configs WHERE provider = ?', id);
    return c.json({ success: true });
  });

  /** GET /:id/models — 从 Provider API 动态拉取模型列表 */
  app.get('/:id/models', async (c) => {
    const id = c.req.param('id');
    const provider = getProvider(id);
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    // 解析 API Key：从 evo_claw.json 获取
    const apiKey = configManager?.getApiKey(id) ?? configManager?.getDefaultApiKey() ?? '';
    if (!apiKey) {
      return c.json({ error: '未配置 API Key，无法拉取模型列表', models: provider.models, source: 'fallback' });
    }

    const result = await fetchModelsFromApi(provider.baseUrl, apiKey, id);

    if (result.success && result.models.length > 0) {
      // 更新内存中的模型列表
      updateProviderModels(id, result.models);
      return c.json({ models: result.models, source: 'api' });
    }

    // 拉取失败，返回硬编码 fallback
    return c.json({
      models: provider.models,
      source: 'fallback',
      error: result.error,
    });
  });

  /** POST /:id/test — 测试 Provider 连接 */
  app.post('/:id/test', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ apiKey?: string }>().catch(() => ({}));

    const provider = getProvider(id);
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    // 用最简请求测试连接
    const apiKey = (body as any).apiKey || provider.apiKeyRef;
    if (!apiKey) {
      return c.json({ success: false, error: '未配置 API Key' });
    }

    try {
      const defaultModel = provider.models.find((m) => m.isDefault) ?? provider.models[0];
      if (!defaultModel) {
        return c.json({ success: false, error: '未配置模型' });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: defaultModel.id,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        return c.json({ success: true, model: defaultModel.id });
      }

      const errBody = await res.text().catch(() => '');
      return c.json({
        success: false,
        error: `HTTP ${res.status}: ${errBody.slice(0, 200)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: message });
    }
  });

  /** GET /default — 获取默认模型配置 */
  app.get('/default/model', (c) => {
    const row = db.get<{ provider: string; model_id: string; config_json: string }>(
      'SELECT provider, model_id, config_json FROM model_configs WHERE is_default = 1 LIMIT 1',
    );
    if (!row) {
      return c.json({ provider: 'openai', modelId: 'gpt-4o-mini' });
    }
    return c.json({ provider: row.provider, modelId: row.model_id });
  });

  /** PUT /default/model — 设置默认模型 */
  app.put('/default/model', async (c) => {
    const body = await c.req.json<{ provider: string; modelId: string }>();

    db.transaction(() => {
      // 清除旧默认
      db.run('UPDATE model_configs SET is_default = 0 WHERE is_default = 1');
      // 设置新默认
      const result = db.run(
        'UPDATE model_configs SET is_default = 1, model_id = ? WHERE provider = ?',
        body.modelId,
        body.provider,
      );
      if (result.changes === 0) {
        // Provider 尚未持久化，创建一条
        const { randomUUID } = require('node:crypto');
        db.run(
          `INSERT INTO model_configs (id, provider, model_id, api_key_ref, config_json, is_default, created_at)
           VALUES (?, ?, ?, '', '{}', 1, ?)`,
          randomUUID(),
          body.provider,
          body.modelId,
          new Date().toISOString(),
        );
      }
    });

    return c.json({ success: true });
  });

  return app;
}
