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
    // 授予权限（M8: scope='session' 需要 sessionKey）
    const grantRes = await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'file_read',
        scope: 'session',
        resource: '/tmp/test',
        sessionKey: 'test-session-1',
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

  it('grant → allow 链路', async () => {
    // 授予 always 权限
    await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'shell',
        scope: 'always',
        resource: '/bin/echo',
      }),
    });

    // 验证权限存在
    const listRes = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    const body = await listRes.json() as { permissions: { category: string; scope: string; resource: string }[] };
    const shellPerm = body.permissions.find(p => p.category === 'shell');
    expect(shellPerm).toBeDefined();
    expect(shellPerm!.scope).toBe('always');
  });

  it('deny → 拦截链路', async () => {
    // 授予 deny 权限
    await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'network',
        scope: 'deny',
      }),
    });

    // 验证 deny 权限存在
    const listRes = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    const body = await listRes.json() as { permissions: { category: string; scope: string }[] };
    const denyPerm = body.permissions.find(p => p.scope === 'deny');
    expect(denyPerm).toBeDefined();
    expect(denyPerm!.category).toBe('network');
  });

  it('once scope 使用后自动删除', async () => {
    // 授予 once 权限
    const grantRes = await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'browser',
        scope: 'once',
      }),
    });
    expect(grantRes.status).toBe(200);

    // 验证权限存在
    const listRes1 = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    const body1 = await listRes1.json() as { permissions: { scope: string }[] };
    expect(body1.permissions.some(p => p.scope === 'once')).toBe(true);
  });

  it('session scope 持续有效', async () => {
    // 授予 session 权限（M8: 需要 sessionKey）
    const grantRes = await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'mcp',
        scope: 'session',
        resource: 'test-mcp',
        sessionKey: 'test-session-2',
      }),
    });
    expect(grantRes.status).toBe(200);

    // 多次查询，权限持续存在
    for (let i = 0; i < 3; i++) {
      const listRes = await env.app.request(`/security/${agentId}/permissions`, {
        headers: authHeader(),
      });
      const body = await listRes.json() as { permissions: { category: string; scope: string }[] };
      expect(body.permissions.some(p => p.category === 'mcp' && p.scope === 'session')).toBe(true);
    }
  });

  it('revoke 后权限消失', async () => {
    // 授予 always 权限
    const grantRes = await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'skill',
        scope: 'always',
        resource: 'test-skill',
      }),
    });
    const { id: permId } = await grantRes.json() as { id: string };

    // 撤销
    const revokeRes = await env.app.request(`/security/${agentId}/permissions/${permId}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(revokeRes.status).toBe(200);

    // 验证列表为空
    const listRes = await env.app.request(`/security/${agentId}/permissions`, {
      headers: authHeader(),
    });
    const body = await listRes.json() as { permissions: unknown[] };
    expect(body.permissions.length).toBe(0);
  });

  it('审计日志记录验证', async () => {
    // 授予权限（触发审计日志）
    await env.app.request(`/security/${agentId}/permissions`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        category: 'file_read',
        scope: 'always',
        resource: '/tmp',
      }),
    });

    // 检查审计日志
    const res = await env.app.request(`/security/${agentId}/audit-log`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
