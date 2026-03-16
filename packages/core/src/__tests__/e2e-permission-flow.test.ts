/**
 * E2E: 权限授予 → 检查生效
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: 权限管理', () => {
  let env: ReturnType<typeof createTestEnv>;
  let agentId: string;

  beforeEach(async () => {
    env = createTestEnv();
    const res = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '权限测试 Agent' }),
    });
    const body = await res.json() as { agent: { id: string } };
    agentId = body.agent.id;
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('初始状态无权限', async () => {
    const res = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { permissions: unknown[] };
    expect(body.permissions).toEqual([]);
  });

  it('授予权限后可列出', async () => {
    // 授予权限
    const grantRes = await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'file_read',
        scope: 'session',
        resource: '/tmp/test',
      }),
    });
    expect(grantRes.status).toBe(200);
    const grantBody = await grantRes.json() as { id: string };
    expect(grantBody.id).toBeTruthy();

    // 列出权限
    const listRes = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    const listBody = await listRes.json() as { permissions: { id: string; category: string; scope: string }[] };
    expect(listBody.permissions.length).toBe(1);
    expect(listBody.permissions[0].category).toBe('file_read');
    expect(listBody.permissions[0].scope).toBe('session');
  });

  it('撤销权限后列表为空', async () => {
    // 授予
    const grantRes = await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ category: 'file_write', scope: 'once' }),
    });
    const { id: permId } = await grantRes.json() as { id: string };

    // 撤销
    const revokeRes = await env.app.request(`/security/${agentId}/permissions/${permId}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(revokeRes.status).toBe(200);

    // 验证
    const listRes = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    const listBody = await listRes.json() as { permissions: unknown[] };
    expect(listBody.permissions.length).toBe(0);
  });

  it('审计日志记录可查询', async () => {
    const res = await env.app.request(`/security/${agentId}/audit-log`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
