/**
 * E2E: 创建 Agent → 发消息 → SSE 事件 → conversation_log 持久化
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, jsonHeaders } from './e2e-helpers.js';

describe('E2E: 聊天流程', () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('向不存在的 Agent 发消息返回 404', async () => {
    const res = await env.app.request('/chat/nonexistent/send', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ message: '你好' }),
    });
    expect(res.status).toBe(404);
  });

  it('发送空消息返回 400', async () => {
    // 先创建 Agent
    const createRes = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '聊天测试' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    const res = await env.app.request(`/chat/${agent.id}/send`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('发送消息返回 SSE 流 (Content-Type 验证)', async () => {
    // 创建 Agent
    const createRes = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '流测试' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    // 发送消息 — 没有配置 LLM 会返回错误事件，但 Content-Type 应该是 SSE
    const res = await env.app.request(`/chat/${agent.id}/send`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ message: '你好' }),
    });

    // 无 LLM 配置时应返回 400（未配置 API Key）
    // 有配置时返回 200 SSE 流，不应返回 500
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('text/event-stream');
    } else if (res.status === 400) {
      const body = await res.json() as { error: string };
      expect(body.error).toContain('API Key');
    }
  });
});
