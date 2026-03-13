import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import crypto from 'node:crypto';
import { PORT_RANGE, TOKEN_BYTES } from '@evoclaw/shared';
import { SqliteStore } from './infrastructure/db/sqlite-store.js';
import { MigrationRunner } from './infrastructure/db/migration-runner.js';
import { AgentManager } from './agent/agent-manager.js';
import { createAgentRoutes } from './routes/agents.js';
import { createChatRoutes } from './routes/chat.js';

/** 在端口范围内生成随机端口 */
function getRandomPort(): number {
  return PORT_RANGE.min + Math.floor(Math.random() * (PORT_RANGE.max - PORT_RANGE.min + 1));
}

/** 生成 256-bit Bearer Token */
function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/** createApp 配置选项 */
export interface CreateAppOptions {
  token: string;
  store?: SqliteStore;
  agentManager?: AgentManager;
}

/** 创建 Hono 应用实例 */
export function createApp(tokenOrOptions: string | CreateAppOptions) {
  const options = typeof tokenOrOptions === 'string'
    ? { token: tokenOrOptions }
    : tokenOrOptions;
  const { token, store, agentManager } = options;

  const app = new Hono();

  // CORS — 仅允许 localhost
  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return '*';
      const url = new URL(origin);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? origin : '';
    },
  }));

  // 健康检查 — 无需认证
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

  // Bearer Token 认证 — 跳过 /health 路径
  app.use('/*', async (c, next) => {
    if (c.req.path === '/health') return next();
    return bearerAuth({ token })(c, next);
  });

  // 挂载业务路由
  if (agentManager) {
    app.route('/agents', createAgentRoutes(agentManager));
  }
  if (store && agentManager) {
    app.route('/chat', createChatRoutes(store, agentManager));
  }

  // 全局错误处理
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error('Unhandled error:', err);
    return c.json({ error: err.message }, 500);
  });

  // 404 处理
  app.notFound((c) => c.json({ error: 'Not Found' }, 404));

  return app;
}

/** 主入口 — 仅在直接执行时运行 */
async function main() {
  const token = process.env.EVOCLAW_TOKEN || generateToken();
  const port = Number(process.env.EVOCLAW_PORT) || getRandomPort();

  // 初始化数据库
  const db = new SqliteStore();
  const migrationRunner = new MigrationRunner(db);
  await migrationRunner.run();

  const agentManager = new AgentManager(db);
  const app = createApp({ token, store: db, agentManager });

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
    // 输出连接信息供 Tauri 读取
    console.log(JSON.stringify({ port: info.port, token }));
  });
}

// 仅当此文件为入口点时自动启动
const isMainModule =
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.cjs') ||
  process.argv[1]?.endsWith('server.js');

if (isMainModule) {
  main().catch(console.error);
}
