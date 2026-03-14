import 'dotenv/config';
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
import { createMemoryRoutes } from './routes/memory.js';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createSecurityRoutes } from './routes/security.js';
import { createKnowledgeRoutes } from './routes/knowledge.js';
import { VectorStore } from './infrastructure/db/vector-store.js';
import { createEmbeddingProvider } from './rag/embedding-provider.js';
import { createSkillRoutes } from './routes/skill.js';
import { createEvolutionRoutes } from './routes/evolution.js';
import { createProviderRoutes } from './routes/provider.js';
import { createCronRoutes } from './routes/cron.js';
import { CronRunner } from './scheduler/cron-runner.js';
import { LaneQueue } from './agent/lane-queue.js';
import { ChannelManager } from './channel/channel-manager.js';
import { DesktopAdapter } from './channel/adapters/desktop.js';
import { createChannelRoutes } from './routes/channel.js';
import { createBindingRoutes } from './routes/binding.js';

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
  vectorStore?: VectorStore;
  cronRunner?: CronRunner;
  channelManager?: ChannelManager;
}

/** 创建 Hono 应用实例 */
export function createApp(tokenOrOptions: string | CreateAppOptions) {
  const options = typeof tokenOrOptions === 'string'
    ? { token: tokenOrOptions }
    : tokenOrOptions;
  const { token, store, agentManager, vectorStore, cronRunner, channelManager } = options;

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
    app.route('/chat', createChatRoutes(store, agentManager, vectorStore));
    // 反馈路由挂载到 /chat，与聊天路由共用前缀
    app.route('/chat', createFeedbackRoutes(store));
  }
  if (store) {
    app.route('/memory', createMemoryRoutes(store, vectorStore));
    app.route('/security', createSecurityRoutes(store));
    if (vectorStore) {
      app.route('/knowledge', createKnowledgeRoutes(store, vectorStore));
    }
    app.route('/skill', createSkillRoutes());
    app.route('/evolution', createEvolutionRoutes(store));
    app.route('/provider', createProviderRoutes(store));
    if (cronRunner) {
      app.route('/cron', createCronRoutes(cronRunner));
    }
    app.route('/binding', createBindingRoutes(store));
    if (channelManager) {
      app.route('/channel', createChannelRoutes(channelManager));
    }
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

  // 初始化 Embedding Provider（如有 API key）
  let vectorStore: VectorStore | undefined;
  const embeddingApiKey = process.env.EVOCLAW_EMBEDDING_API_KEY;
  const embeddingBaseUrl = process.env.EVOCLAW_EMBEDDING_BASE_URL;
  if (embeddingApiKey && embeddingBaseUrl) {
    const provider = createEmbeddingProvider(
      embeddingBaseUrl,
      embeddingApiKey,
      process.env.EVOCLAW_EMBEDDING_PROVIDER,
    );
    const embeddingFn = (text: string) => provider.generate(text);
    vectorStore = new VectorStore(db, embeddingFn);
  } else {
    vectorStore = new VectorStore(db);
  }

  const agentManager = new AgentManager(db);

  // 初始化 LaneQueue + CronRunner
  const laneQueue = new LaneQueue();
  const cronRunner = new CronRunner(db, laneQueue);
  cronRunner.start();

  // 初始化 ChannelManager + Desktop 适配器
  const channelManager = new ChannelManager();
  const desktopAdapter = new DesktopAdapter();
  channelManager.registerAdapter(desktopAdapter);
  desktopAdapter.connect({ type: 'local', name: '桌面', credentials: {} });

  const app = createApp({ token, store: db, agentManager, vectorStore, cronRunner, channelManager });

  // 进程退出时清理
  const cleanup = () => {
    cronRunner.stop();
    channelManager.disconnectAll();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

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
