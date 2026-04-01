/**
 * POC: 测试 Hono + Bun 的 HTTP 服务兼容性
 *
 * 测试项:
 * 1. Hono 创建和路由
 * 2. SSE streaming
 * 3. Bearer auth 中间件
 * 4. CORS
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { streamSSE } from 'hono/streaming';

const results: Array<{ test: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ test: name, status: 'PASS' });
  } catch (err) {
    results.push({ test: name, status: 'FAIL', detail: String(err) });
  }
}

const TOKEN = 'test-token-123';
const app = new Hono();

app.use('*', cors({ origin: '*' }));
app.use('/api/*', bearerAuth({ token: TOKEN }));

app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/api/agents', (c) => c.json({ agents: [{ id: '1', name: 'Test' }] }));
app.get('/api/stream', (c) => {
  return streamSSE(c, async (stream) => {
    for (let i = 0; i < 3; i++) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'text', delta: `chunk-${i}` }) });
    }
  });
});

// 使用 Bun.serve 或 @hono/node-server
let server: any;
const PORT = 19876;

await test('1. 启动 Hono 服务', async () => {
  // 尝试 Bun 原生 serve
  if (typeof Bun !== 'undefined') {
    server = Bun.serve({ port: PORT, fetch: app.fetch });
  } else {
    const { serve } = await import('@hono/node-server');
    server = serve({ fetch: app.fetch, port: PORT });
  }
});

await test('2. GET /health (无 auth)', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/health`);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(`Expected ok, got ${JSON.stringify(data)}`);
});

await test('3. GET /api/agents (Bearer auth)', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const data = await res.json();
  if (!data.agents || data.agents.length !== 1) throw new Error(`Unexpected data: ${JSON.stringify(data)}`);
});

await test('4. GET /api/agents (无 auth → 401)', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents`);
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

await test('5. SSE Streaming', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/stream`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  if (!text.includes('chunk-0') || !text.includes('chunk-2')) {
    throw new Error(`SSE data incomplete: ${text.slice(0, 200)}`);
  }
});

// 清理
if (server) {
  if (typeof server.stop === 'function') server.stop();
  else if (typeof server.close === 'function') server.close();
}

// 输出结果
console.log('\n=== Hono + Bun HTTP 兼容性测试 ===\n');
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${r.test}`);
  if (r.detail) console.log(`   ${r.detail}`);
}
const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\n结果: ${passed}/${results.length} 通过`);
