/**
 * E2E: Agent 引导式创建全流程
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, jsonHeaders, authHeader } from './e2e-helpers.js';

describe('E2E: Agent 引导式创建', () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('完整 6 阶段引导创建流程', async () => {
    // 1. 启动引导 — 无 message，返回 role 阶段开场
    const startRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json() as { sessionId: string; response: { stage: string; message: string; done: boolean } };
    expect(startBody.sessionId).toBeTruthy();
    expect(startBody.response.stage).toBe('role');
    expect(startBody.response.done).toBe(false);

    const sid = startBody.sessionId;

    // 2. role → expertise
    const roleRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: '资深程序员' }),
    });
    const roleBody = await roleRes.json() as { response: { stage: string; done: boolean } };
    expect(roleBody.response.stage).toBe('expertise');
    expect(roleBody.response.done).toBe(false);

    // 3. expertise → style
    const expertiseRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: 'TypeScript 和 React 开发' }),
    });
    const expertiseBody = await expertiseRes.json() as { response: { stage: string } };
    expect(expertiseBody.response.stage).toBe('style');

    // 4. style → constraints
    const styleRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: '简洁高效' }),
    });
    const styleBody = await styleRes.json() as { response: { stage: string } };
    expect(styleBody.response.stage).toBe('constraints');

    // 5. constraints → preview（生成工作区文件预览）
    const constraintsRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: '无' }),
    });
    const constraintsBody = await constraintsRes.json() as {
      response: { stage: string; preview?: Record<string, string>; done: boolean };
    };
    expect(constraintsBody.response.stage).toBe('preview');
    expect(constraintsBody.response.done).toBe(false);
    expect(constraintsBody.response.preview).toBeTruthy();
    // 验证 8 个工作区文件
    const preview = constraintsBody.response.preview!;
    expect(preview['SOUL.md']).toContain('行为哲学');
    expect(preview['SOUL.md']).toContain('资深程序员');
    expect(preview['IDENTITY.md']).toBeTruthy();
    expect(preview['AGENTS.md']).toContain('简洁高效');
    expect(preview['TOOLS.md']).toBeTruthy();
    expect(preview['HEARTBEAT.md']).toBeTruthy();
    expect(preview['BOOTSTRAP.md']).toBeTruthy();

    // 6. preview → done（确认创建）
    const confirmRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: '确认' }),
    });
    const confirmBody = await confirmRes.json() as {
      response: { stage: string; agentId?: string; done: boolean };
    };
    expect(confirmBody.response.stage).toBe('done');
    expect(confirmBody.response.done).toBe(true);
    expect(confirmBody.response.agentId).toBeTruthy();

    // 7. 验证 Agent 已创建且状态为 active
    const agentRes = await env.app.request(`/agents/${confirmBody.response.agentId}`, {
      headers: authHeader(),
    });
    expect(agentRes.status).toBe(200);
    const agentBody = await agentRes.json() as { agent: { status: string; name: string } };
    expect(agentBody.agent.status).toBe('active');
    // 名称从角色描述生成
    expect(agentBody.agent.name).toBeTruthy();
  });

  it('preview 阶段可修改名称', async () => {
    const sid = await advanceToPreview(env);

    // 修改名称
    const renameRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: '修改名称 代码大师' }),
    });
    const renameBody = await renameRes.json() as {
      response: { stage: string; message: string; preview?: Record<string, string> };
    };
    expect(renameBody.response.stage).toBe('preview');
    expect(renameBody.response.message).toContain('代码大师');
    // IDENTITY.md 应包含新名称
    expect(renameBody.response.preview?.['IDENTITY.md']).toContain('代码大师');
  });

  it('preview 阶段可重新开始', async () => {
    const sid = await advanceToPreview(env);

    // 重来
    const restartRes = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sid, message: '重来' }),
    });
    const restartBody = await restartRes.json() as { response: { stage: string } };
    expect(restartBody.response.stage).toBe('role');
  });
});

/** 辅助：快速推进到 preview 阶段 */
async function advanceToPreview(env: ReturnType<typeof createTestEnv>): Promise<string> {
  const steps = [
    {},
    { message: '编程助手' },
    { message: 'Python 和数据分析' },
    { message: '耐心教学' },
    { message: '无' },
  ];

  let sessionId = '';
  for (const step of steps) {
    const res = await env.app.request('/agents/create-guided', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ sessionId: sessionId || undefined, ...step }),
    });
    const body = await res.json() as { sessionId: string };
    sessionId = body.sessionId;
  }
  return sessionId;
}
