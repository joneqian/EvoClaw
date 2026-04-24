/**
 * Provider 管理路由 — LLM Provider 配置与测试
 */

import { Hono } from 'hono';
import {
  getProviders,
  getProvider,
  registerProvider,
  unregisterProvider,
  registerFromExtension,
} from '../provider/provider-registry.js';
import { getProviderKeyStatus, resetKeyState } from '../infrastructure/provider-key-state.js';
import { getProviderExtension, getAllProviderExtensions } from '../provider/extensions/index.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ProviderConfig } from '@evoclaw/shared';

/** 已知 Embedding 模型维度速查表 — 用于自动补全 dimension */
const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
  // OpenAI
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Qwen (通义千问)
  'text-embedding-v1': 1536,
  'text-embedding-v2': 1536,
  'text-embedding-v3': 1024,
  'text-embedding-v4': 1024,
  // GLM (智谱)
  'embedding-2': 1024,
  'embedding-3': 2048,
  // Doubao (豆包)
  'doubao-embedding': 1024,
  'doubao-embedding-large': 1024,
  // Cohere
  'embed-english-v3.0': 1024,
  'embed-multilingual-v3.0': 1024,
  // Voyage
  'voyage-3': 1024,
  'voyage-3-lite': 512,
};

/** 根据模型 ID 猜测 embedding dimension */
function guessEmbeddingDimension(modelId: string): number | undefined {
  // 精确匹配
  if (KNOWN_EMBEDDING_DIMENSIONS[modelId]) return KNOWN_EMBEDDING_DIMENSIONS[modelId];
  // 前缀匹配（处理带日期后缀的版本号）
  for (const [key, dim] of Object.entries(KNOWN_EMBEDDING_DIMENSIONS)) {
    if (modelId.startsWith(key)) return dim;
  }
  return undefined;
}

/** 获取所有可用的 provider 预设列表（前端新增 Provider 下拉框用） */
function listAvailableExtensions() {
  return getAllProviderExtensions().map(ext => ({
    id: ext.id,
    name: ext.name,
    defaultBaseUrl: ext.defaultBaseUrl,
    api: ext.api,
    modelCount: ext.models.length,
  }));
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

  /** M6 T1: GET /:id/key-status — 获取凭据池每把 Key 的运行时状态（UI 回显） */
  app.get('/:id/key-status', (c) => {
    const id = c.req.param('id');
    const pool = configManager?.getProvider(id)?.credentialPool;
    const states = getProviderKeyStatus(id);
    const keys = (pool?.keys ?? []).map((k) => ({
      id: k.id,
      enabled: k.enabled,
      state: states[k.id] ?? { failCount: 0, disabled: false },
    }));
    return c.json({
      strategy: pool?.strategy ?? null,
      keys,
    });
  });

  /** M6 T1: POST /:id/key-reset — 手动重置某把 Key 的失败状态（用户在 UI 点「重新启用」时调用） */
  app.post('/:id/key-reset', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ keyId: string }>();
    if (!body.keyId) return c.json({ error: 'keyId 必填' }, 400);
    resetKeyState(id, body.keyId);
    return c.json({ ok: true });
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

  /** GET /extensions — 获取所有可用的 provider 预设 */
  app.get('/extensions/list', (c) => {
    return c.json({ extensions: listAvailableExtensions() });
  });

  /** GET /:id/models — 从 extension 预设获取模型列表 */
  app.get('/:id/models', (c) => {
    const id = c.req.param('id');
    const provider = getProvider(id);
    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    // 从 extension 获取预设模型（包含准确的 contextWindow/maxTokens）
    const ext = getProviderExtension(id);
    if (ext) {
      // 合并预设模型 + provider 中已有的自定义模型（如 embedding）
      const presetIds = new Set(ext.models.map(m => m.id));
      const customModels = provider.models.filter(m => !presetIds.has(m.id));
      const presetModels = ext.models.map((m, i) => ({
        id: m.id,
        name: m.name,
        provider: id,
        maxContextLength: m.contextWindow,
        maxOutputTokens: m.maxTokens,
        supportsVision: m.input.includes('image'),
        supportsToolUse: m.toolUse !== false,
        isDefault: m.isDefault ?? i === 0,
        ...(m.dimension ? { dimension: m.dimension } : {}),
      }));
      return c.json({ models: [...presetModels, ...customModels], source: 'extension' });
    }

    // 无预设，返回已注册的模型
    return c.json({ models: provider.models, source: 'registry' });
  });

  /** POST /:id/sync-models — 从 extension 重新加载预设模型 */
  app.post('/:id/sync-models', (c) => {
    const id = c.req.param('id');
    const ext = getProviderExtension(id);
    if (!ext) {
      return c.json({ success: false, error: `未找到 ${id} 的模型预设` });
    }

    // 重新注册内存注册表
    const provider = getProvider(id);
    if (provider) {
      registerFromExtension(id, provider.apiKeyRef);
    }

    // 持久化到 evo_claw.json
    if (configManager) {
      const configEntry = configManager.getProvider(id);
      if (configEntry) {
        // 保留用户自定义模型（不在预设中的，如手动添加的 embedding）
        const presetIds = new Set(ext.models.map(m => m.id));
        const preserved = configEntry.models.filter(m => !presetIds.has(m.id));
        configEntry.models = [
          ...ext.models.map(m => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            input: m.input as string[],
            ...(m.dimension ? { dimension: m.dimension } : {}),
          })),
          ...preserved,
        ];
        configManager.setProvider(id, configEntry);
      }
    }

    return c.json({
      success: true,
      count: ext.models.length,
      source: 'extension',
    });
  });

  /** POST /:id/test — 测试 Provider 连接 */
  app.post('/:id/test', async (c) => {
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
      // 简单测试：用第一个模型发一个小请求验证 API Key 有效
      const ext = getProviderExtension(id);
      const testModel = ext?.models[0]?.id ?? provider?.models[0]?.id ?? 'gpt-4o-mini';

      const { buildAuthHeaders } = await import('../provider/model-fetcher.js');
      const headers = buildAuthHeaders(apiKey, id, baseUrl);

      // Anthropic 协议端点（含兼容端点如 DeepSeek /anthropic）通常不暴露 /models，
      // 用 POST /v1/messages + max_tokens:1 做最小探测；其他协议仍走 /models。
      const isAnthropic =
        id === 'anthropic' ||
        baseUrl.includes('anthropic.com') ||
        /\/anthropic(\/|$)/.test(baseUrl);

      let testResp: Response;
      if (isAnthropic) {
        const anthropicBase = /\/v1\/?$/.test(baseUrl)
          ? baseUrl.replace(/\/+$/, '')
          : `${baseUrl.replace(/\/+$/, '')}/v1`;
        testResp = await fetch(`${anthropicBase}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: testModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } else {
        testResp = await fetch(`${baseUrl}/models`, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
      }

      if (!testResp.ok) {
        const errText = await testResp.text().catch(() => '');
        return c.json({ success: false, error: `API 验证失败: HTTP ${testResp.status} ${errText.slice(0, 200)}` });
      }

      return c.json({
        success: true,
        model: testModel,
        count: ext?.models.length ?? provider?.models.length ?? 0,
        source: 'extension',
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
      // 检查模型是否有 dimension，没有则尝试自动补全
      const provider = configManager.getProvider(body.provider);
      if (provider) {
        const model = provider.models.find(m => m.id === body.modelId);
        if (model && !model.dimension) {
          const autoDim = guessEmbeddingDimension(body.modelId);
          if (autoDim) {
            model.dimension = autoDim;
            configManager.setProvider(body.provider, provider);
          } else {
            return c.json({ success: false, error: '该 Embedding 模型缺少向量维度（dimension），请先在模型列表中设置' }, 400);
          }
        }
      }

      configManager.setEmbeddingModelRef(body.provider, body.modelId);
    }

    return c.json({ success: true });
  });

  return app;
}
