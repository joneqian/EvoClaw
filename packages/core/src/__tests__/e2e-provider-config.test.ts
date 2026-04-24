/**
 * E2E: 写入 config → 注册 Provider → 设默认模型
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: Provider 配置', () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('PUT /config 写入完整配置', async () => {
    const res = await env.app.request('/config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        models: {
          default: 'deepseek/deepseek-v4-flash',
          providers: {
            deepseek: {
              baseUrl: 'https://api.deepseek.com/anthropic',
              apiKey: 'sk-test',
              api: 'anthropic-messages',
              models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
            },
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.validation.valid).toBe(true);
  });

  it('GET /config/validate 返回校验结果', async () => {
    // 空配置 — 校验失败
    const res1 = await env.app.request('/config/validate', { headers: authHeader() });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.valid).toBe(false);

    // 写入有效配置后 — 校验通过
    await env.app.request('/config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        models: {
          default: 'qwen/qwen-turbo',
          providers: {
            qwen: {
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              apiKey: 'sk-test',
              api: 'openai-completions',
              models: [{ id: 'qwen-turbo', name: 'Qwen Turbo' }],
            },
          },
        },
      }),
    });

    const res2 = await env.app.request('/config/validate', { headers: authHeader() });
    const body2 = await res2.json();
    expect(body2.valid).toBe(true);
  });

  it('PUT /config/provider/:id 添加 Provider', async () => {
    const res = await env.app.request('/config/provider/openai', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
        models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
      }),
    });
    expect(res.status).toBe(200);

    // 验证已添加
    const configRes = await env.app.request('/config', { headers: authHeader() });
    const configBody = await configRes.json();
    expect(configBody.config.models.providers.openai).toBeDefined();
    expect(configBody.config.models.providers.openai.apiKey).toBe('***');
  });

  it('DELETE /config/provider/:id 删除 Provider', async () => {
    // 先添加
    await env.app.request('/config/provider/test-provider', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        baseUrl: 'https://test.example.com/v1',
        apiKey: 'sk-test',
        api: 'openai-completions',
        models: [],
      }),
    });

    // 删除
    const delRes = await env.app.request('/config/provider/test-provider', {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(delRes.status).toBe(200);

    // 验证已删除
    const configRes = await env.app.request('/config', { headers: authHeader() });
    const configBody = await configRes.json();
    expect(configBody.config.models?.providers?.['test-provider']).toBeUndefined();
  });

  it('POST /config/reload 从磁盘重新加载', async () => {
    // 写入配置
    await env.app.request('/config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        models: {
          default: 'openai/gpt-4o-mini',
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test',
              api: 'openai-completions',
              models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
            },
          },
        },
      }),
    });

    // 重新加载
    const res = await env.app.request('/config/reload', {
      method: 'POST',
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.validation.valid).toBe(true);
  });
});
