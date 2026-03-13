import { describe, it, expect } from 'vitest';
import { createApp } from '../server.js';

const TEST_TOKEN = 'test-secret-token-for-unit-tests';

describe('Hono Server', () => {
  const app = createApp(TEST_TOKEN);

  it('GET /health 应该返回 200 且无需认证', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTypeOf('number');
  });

  it('受保护路由无 Token 应返回 401', async () => {
    const res = await app.request('/api/agents');
    expect(res.status).toBe(401);
  });

  it('受保护路由使用错误 Token 应返回 401', async () => {
    const res = await app.request('/api/agents', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
  });

  it('受保护路由使用正确 Token 应通过认证', async () => {
    // 未注册的路由会返回 404，但不应该是 401
    const res = await app.request('/api/agents', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    // 通过了认证但路由不存在，应该返回 404 而不是 401
    expect(res.status).toBe(404);
  });

  it('未知路由应返回 404', async () => {
    const res = await app.request('/nonexistent', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Not Found');
  });

  it('/health 端点不应被 Bearer Token 拦截', async () => {
    // 即使携带了错误的 Token，/health 也应该正常返回
    const res = await app.request('/health', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(200);
  });
});
