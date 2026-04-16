/**
 * E2E: 启动 + health + config 写入后 health=ok
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: 启动与健康检查', () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('GET /health 无需认证即可访问', async () => {
    const res = await env.app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timestamp).toBeTypeOf('number');
  });

  it('空配置时 /health 返回 needs-setup', async () => {
    const res = await env.app.request('/health');
    const body = await res.json();
    expect(body.status).toBe('needs-setup');
    expect(body.missing).toBeDefined();
    expect(body.missing.length).toBeGreaterThan(0);
  });

  it('写入有效配置后 /health 返回 ok', async () => {
    // 写入最小有效配置
    const configRes = await env.app.request('/config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        models: {
          default: 'openai/gpt-4o-mini',
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test-key',
              api: 'openai-completions',
              models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
            },
          },
        },
      }),
    });
    expect(configRes.status).toBe(200);
    const configBody = await configRes.json();
    expect(configBody.success).toBe(true);

    // 验证 health 已变为 ok
    const healthRes = await env.app.request('/health');
    const healthBody = await healthRes.json();
    expect(healthBody.status).toBe('ok');
  });

  it('受保护路由无 Token 返回 401', async () => {
    const res = await env.app.request('/agents');
    expect(res.status).toBe(401);
  });

  it('受保护路由错误 Token 返回 401', async () => {
    const res = await env.app.request('/agents', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('受保护路由正确 Token 通过认证', async () => {
    const res = await env.app.request('/agents', { headers: authHeader() });
    expect(res.status).toBe(200);
  });

  it('GET /config 返回配置（apiKey 被隐藏）', async () => {
    // 先写入配置
    await env.app.request('/config', {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({
        models: {
          default: 'openai/gpt-4o-mini',
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-real-secret',
              api: 'openai-completions',
              models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
            },
          },
        },
      }),
    });

    const res = await env.app.request('/config', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.models.providers.openai.apiKey).toBe('***');
  });
});
