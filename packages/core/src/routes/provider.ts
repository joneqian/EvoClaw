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
    const result = providers.map((p) => {
      // 从 evo_claw.json 获取额外信息（api 协议、脱敏 apiKey、模型维度）
      const configEntry = configManager?.getProvider(p.id);
      const maskedKey = configEntry?.apiKey
        ? configEntry.apiKey.slice(0, 6) + '***' + configEntry.apiKey.slice(-4)
        : undefined;
      // 从 config 中读取 dimension 信息，补充到 models 上
      const configModelsMap = new Map(
        (configEntry?.models ?? []).map((m) => [m.id, m]),
      );
      const models = p.models.map((m) => {
        const cm = configModelsMap.get(m.id);
        return { ...m, dimension: cm?.dimension };
      });
      // 补充 config 中有但 registry 中没有的模型（如 embedding 模型）
      for (const cm of configEntry?.models ?? []) {
        if (!models.find((m) => m.id === cm.id)) {
          models.push({
            id: cm.id,
            name: cm.name,
            provider: p.id,
            maxContextLength: cm.contextWindow ?? 0,
            maxOutputTokens: cm.maxTokens ?? 0,
            supportsVision: false,
            supportsToolUse: false,
            isDefault: false,
            dimension: cm.dimension,
          });
        }
      }
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        hasApiKey: !!p.apiKeyRef,
        maskedApiKey: maskedKey,
        api: configEntry?.api ?? 'openai-completions',
        models,
      };
    });
    return c.json({ providers: result });
  });

  /** GET /:id/apikey — 获取完整 API Key（前端眼睛按钮点击时调用） */
  app.get('/:id/apikey', (c) => {
    const id = c.req.param('id');
    const apiKey = configManager?.getApiKey(id) ?? '';
    if (!apiKey) {
      return c.json({ error: '未配置 API Key' }, 404);
    }
    return c.json({ apiKey });
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

  /** POST /:id/sync-models — 从 Provider API 拉取模型并持久化到 evo_claw.json */
  app.post('/:id/sync-models', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ apiKey?: string; baseUrl?: string }>().catch(() => ({}));

    // 支持传入临时 apiKey/baseUrl（SetupPage 首次配置时 Provider 可能尚未注册）
    const provider = getProvider(id);
    const apiKey = body.apiKey || configManager?.getApiKey(id) || provider?.apiKeyRef || '';
    const baseUrl = body.baseUrl || provider?.baseUrl || '';

    if (!apiKey) {
      return c.json({ success: false, error: '未配置 API Key' });
    }
    if (!baseUrl) {
      return c.json({ success: false, error: '未配置 Base URL' });
    }

    const result = await fetchModelsFromApi(baseUrl, apiKey, id);

    if (!result.success || result.models.length === 0) {
      return c.json({
        success: false,
        error: result.error || '未获取到模型',
        models: provider?.models ?? [],
        source: 'fallback',
      });
    }

    // 更新内存注册表
    if (provider) {
      updateProviderModels(id, result.models);
    }

    // 持久化到 evo_claw.json（保留原有的 embedding 等非对话模型）
    if (configManager) {
      const configEntry = configManager.getProvider(id);
      if (configEntry) {
        // 收集新拉取的模型 ID 集合
        const newIds = new Set(result.models.map((m) => m.id));
        // 保留原列表中不在新列表里的模型（如 embedding 模型）
        const preserved = configEntry.models.filter((m) => !newIds.has(m.id));
        configEntry.models = [
          ...result.models.map((m) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.maxContextLength,
            maxTokens: m.maxOutputTokens,
            input: m.supportsVision ? ['text', 'image'] : ['text'],
          })),
          ...preserved,
        ];
        configManager.setProvider(id, configEntry);
      }
    }

    return c.json({
      success: true,
      models: result.models,
      count: result.models.length,
      source: 'api',
    });
  });

  /** POST /:id/test — 测试 Provider 连接 */
  app.post('/:id/test', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ apiKey?: string; baseUrl?: string; model?: string; api?: string }>().catch(() => ({}));

    // 优先用请求体传入的参数（SetupPage 首次配置时 Provider 尚未注册）
    const provider = getProvider(id);
    const apiKey = body.apiKey || provider?.apiKeyRef;
    if (!apiKey) {
      return c.json({ success: false, error: '未配置 API Key' });
    }

    // 从已注册 Provider 或 PROVIDER_PRESETS 推断 baseUrl 和 model
    const baseUrl = body.baseUrl || provider?.baseUrl;
    if (!baseUrl) {
      return c.json({ success: false, error: '未配置 Base URL' });
    }

    const modelId = body.model
      || provider?.models?.find((m) => m.isDefault)?.id
      || provider?.models?.[0]?.id
      || 'gpt-4o-mini';

    const apiType = body.api || 'openai-completions';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      // Anthropic 使用不同的 API 格式
      const isAnthropic = apiType === 'anthropic';
      const url = isAnthropic
        ? `${baseUrl}/messages`
        : `${baseUrl}/chat/completions`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isAnthropic) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      const reqBody = isAnthropic
        ? { model: modelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 }
        : { model: modelId, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1 };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        return c.json({ success: true, model: modelId });
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
    // 优先从数据库读
    const row = db.get<{ provider: string; model_id: string }>(
      'SELECT provider, model_id FROM model_configs WHERE is_default = 1 LIMIT 1',
    );
    if (row) {
      return c.json({ provider: row.provider, modelId: row.model_id });
    }
    // fallback: 从 evo_claw.json 读
    if (configManager) {
      const ref = configManager.getDefaultModelRef();
      if (ref) {
        return c.json({ provider: ref.provider, modelId: ref.modelId });
      }
    }
    return c.json({ provider: 'openai', modelId: 'gpt-4o-mini' });
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
