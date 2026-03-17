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
import { toPIProvider, toEvoClawProvider } from '../provider/pi-provider-map.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ProviderConfig } from '@evoclaw/shared';

/** PI ModelRegistry 模型信息 */
interface PIModelInfo {
  id: string;
  name: string;
  provider: string;
  api: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

/** 通过 PI ModelRegistry 获取指定 provider 的模型列表 */
async function syncModelsFromPI(
  providerId: string,
  apiKey: string,
  caller: string,
): Promise<PIModelInfo[]> {
  const piProviderId = toPIProvider(providerId);
  console.log(
    `[provider:${caller}] 尝试通过 PI ModelRegistry 获取模型 (evoclaw=${providerId}, pi=${piProviderId})`,
  );

  const piAi = await import('@mariozechner/pi-ai');
  const piCoding = await import('@mariozechner/pi-coding-agent');

  piAi.registerBuiltInApiProviders();

  // 使用 PI 的 provider ID 注册 API Key
  const authStorage = piCoding.AuthStorage.inMemory({
    [piProviderId]: { type: 'api_key' as const, key: apiKey },
  });
  const modelRegistry = new piCoding.ModelRegistry(authStorage);

  const allModels = modelRegistry.getAll() as PIModelInfo[];
  // 用 PI provider ID 过滤
  const providerModels = allModels.filter((m) => m.provider === piProviderId);

  console.log(
    `[provider:${caller}] PI ModelRegistry.getAll() 返回 ${allModels.length} 个模型（全部 provider）`,
  );

  if (providerModels.length > 0) {
    console.log(
      `[provider:${caller}] 匹配 pi_provider=${piProviderId} 的模型 ${providerModels.length} 个:`,
    );
    for (const m of providerModels) {
      console.log(
        `  - ${m.id} (api=${m.api}, ctx=${m.contextWindow ?? '?'}, maxTok=${m.maxTokens ?? '?'}, input=${JSON.stringify(m.input ?? [])})`,
      );
    }
  } else {
    console.log(
      `[provider:${caller}] PI 未收录 provider (evoclaw=${providerId}, pi=${piProviderId})，将回退到 API 拉取`,
    );
    const knownProviders = [...new Set(allModels.map((m) => m.provider))];
    console.log(
      `[provider:${caller}] PI 已知 providers: ${knownProviders.join(', ')}`,
    );
  }

  return providerModels;
}

/** 将 PI 模型列表持久化到内存注册表 + evo_claw.json */
function persistSyncedModels(
  providerId: string,
  piModels: PIModelInfo[],
  provider: ReturnType<typeof getProvider>,
  configManager?: ConfigManager,
): void {
  // 更新内存注册表
  if (provider) {
    updateProviderModels(
      providerId,
      piModels.map((m, i) => ({
        id: m.id,
        name: m.name || m.id,
        provider: providerId,
        maxContextLength: m.contextWindow ?? 128_000,
        maxOutputTokens: m.maxTokens ?? 8192,
        supportsVision: m.input?.includes('image') ?? false,
        supportsToolUse: true,
        isDefault: i === 0,
      })),
    );
  }

  // 持久化到 evo_claw.json（保留原有的 embedding 等非对话模型）
  if (configManager) {
    const configEntry = configManager.getProvider(providerId);
    if (configEntry) {
      const newIds = new Set(piModels.map((m) => m.id));
      const preserved = configEntry.models.filter((m) => !newIds.has(m.id));
      configEntry.models = [
        ...piModels.map((m) => ({
          id: m.id,
          name: m.name || m.id,
          contextWindow: m.contextWindow ?? 128_000,
          maxTokens: m.maxTokens ?? 8192,
          input: m.input ?? ['text'],
        })),
        ...preserved,
      ];
      configManager.setProvider(providerId, configEntry);
    }
  }
}

/** 创建 Provider 路由 */
export function createProviderRoutes(
  db: SqliteStore,
  configManager?: ConfigManager,
): Hono {
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
    // apiKeyRef 未传时保留已有值
    const apiKeyRef = body.apiKeyRef ?? existing?.apiKeyRef ?? '';

    registerProvider({
      id,
      name: body.name,
      baseUrl: body.baseUrl,
      apiKeyRef,
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
        apiKeyRef,
        JSON.stringify({
          name: body.name,
          baseUrl: body.baseUrl,
          models: body.models ?? [],
        }),
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
        apiKeyRef,
        JSON.stringify({
          name: body.name,
          baseUrl: body.baseUrl,
          models: body.models ?? [],
        }),
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
    const apiKey =
      configManager?.getApiKey(id) ?? configManager?.getDefaultApiKey() ?? '';
    if (!apiKey) {
      return c.json({
        error: '未配置 API Key，无法拉取模型列表',
        models: provider.models,
        source: 'fallback',
      });
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

  /** 通过 PI ModelRegistry 拉取模型并持久化，回退到 API 拉取（sync-models 和 test 共用） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSyncOrTest = async (c: any) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      apiKey?: string;
      baseUrl?: string;
    };

    const provider = getProvider(id);
    const apiKey =
      body.apiKey || configManager?.getApiKey(id) || provider?.apiKeyRef || '';
    const baseUrl = body.baseUrl || provider?.baseUrl || '';

    if (!apiKey) {
      return c.json({ success: false, error: '未配置 API Key' });
    }

    try {
      // 优先通过 PI ModelRegistry 获取模型列表
      const piModels = await syncModelsFromPI(id, apiKey, 'sync');

      if (piModels.length > 0) {
        persistSyncedModels(id, piModels, provider, configManager);
        return c.json({
          success: true,
          model: piModels[0].id,
          count: piModels.length,
          source: 'pi',
        });
      }

      // PI 未收录该 provider，回退到 API 拉取（国产模型等）
      console.log(
        `[provider:sync] 回退到 fetchModelsFromApi (baseUrl=${baseUrl})`,
      );
      if (!baseUrl) {
        return c.json({
          success: false,
          error: '未配置 Base URL，且 PI 未收录该 Provider 的模型',
        });
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

      // 持久化到 evo_claw.json
      if (configManager) {
        const configEntry = configManager.getProvider(id);
        if (configEntry) {
          const newIds = new Set(result.models.map((m) => m.id));
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
        model: result.models[0].id,
        count: result.models.length,
        source: 'api',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ success: false, error: message });
    }
  };

  app.post('/:id/sync-models', handleSyncOrTest);
  app.post('/:id/test', handleSyncOrTest);

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

  /** PUT /default/model — 设置默认 LLM 模型 */
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

    // 同步到 evo_claw.json
    if (configManager) {
      configManager.setDefaultModelRef(body.provider, body.modelId);
    }

    return c.json({ success: true });
  });

  /** GET /default/embedding — 获取默认 Embedding 模型 */
  app.get('/default/embedding', (c) => {
    if (configManager) {
      const ref = configManager.getEmbeddingModelRef();
      if (ref) {
        return c.json({ provider: ref.provider, modelId: ref.modelId });
      }
    }
    return c.json({ provider: '', modelId: '' });
  });

  /** PUT /default/embedding — 设置默认 Embedding 模型 */
  app.put('/default/embedding', async (c) => {
    const body = await c.req.json<{ provider: string; modelId: string }>();

    if (configManager) {
      configManager.setEmbeddingModelRef(body.provider, body.modelId);
    }

    return c.json({ success: true });
  });

  return app;
}
