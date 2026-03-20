import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import crypto from 'node:crypto';
import { PORT_RANGE, TOKEN_BYTES } from '@evoclaw/shared';
import { SqliteStore } from './infrastructure/db/sqlite-store.js';
import { MigrationRunner } from './infrastructure/db/migration-runner.js';
import { ConfigManager } from './infrastructure/config-manager.js';
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
import { createConfigRoutes } from './routes/config.js';
import { createCronRoutes } from './routes/cron.js';
import { CronRunner } from './scheduler/cron-runner.js';
import { LaneQueue } from './agent/lane-queue.js';
import { ChannelManager } from './channel/channel-manager.js';
import { DesktopAdapter } from './channel/adapters/desktop.js';
import { createChannelRoutes } from './routes/channel.js';
import { createBindingRoutes } from './routes/binding.js';
import { createDoctorRoutes } from './routes/doctor.js';
import { MemoryMonitor } from './infrastructure/memory-monitor.js';
import {
  createLogger,
  closeLogger,
  LOG_PATH,
} from './infrastructure/logger.js';
import { callLLM } from './agent/llm-client.js';
import { registerProvider } from './provider/provider-registry.js';
import { HybridSearcher } from './memory/hybrid-searcher.js';
import { MemoryExtractor } from './memory/memory-extractor.js';
import { UserMdRenderer } from './memory/user-md-renderer.js';
import { SkillDiscoverer } from './skill/skill-discoverer.js';
import { MemoryStore } from './memory/memory-store.js';
import { KnowledgeGraphStore } from './memory/knowledge-graph.js';
import { FtsStore } from './infrastructure/db/fts-store.js';

const log = createLogger('server');

// 全局 unhandled rejection 保护 — 防止 PI 框架等第三方库的异常直接 crash 进程
process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  log.error(`Unhandled rejection (已捕获，进程继续运行): ${detail}`);
});

process.on('uncaughtException', (err) => {
  log.error(`Uncaught exception (已捕获，进程继续运行): ${err.message}\n${err.stack}`);
  // 注意：仅捕获日志，不退出。对于真正致命的错误，Node.js 仍会退出
});

process.on('SIGTERM', () => {
  log.info('收到 SIGTERM 信号，准备优雅关闭...');
});

process.on('SIGINT', () => {
  log.info('收到 SIGINT 信号，准备优雅关闭...');
});

/** 在端口范围内生成随机端口 */
function getRandomPort(): number {
  return (
    PORT_RANGE.min +
    Math.floor(Math.random() * (PORT_RANGE.max - PORT_RANGE.min + 1))
  );
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
  configManager?: ConfigManager;
  laneQueue?: LaneQueue;
  /** 记忆系统：混合检索器 */
  hybridSearcher?: HybridSearcher;
  /** 记忆系统：记忆提取器 */
  memoryExtractor?: MemoryExtractor;
  /** USER.md / MEMORY.md 动态渲染器 */
  userMdRenderer?: UserMdRenderer;
  /** Skill 发现器 */
  skillDiscoverer?: SkillDiscoverer;
  /** 内存监控 */
  memoryMonitor?: MemoryMonitor;
}

/** 创建 Hono 应用实例 */
export function createApp(tokenOrOptions: string | CreateAppOptions) {
  const options =
    typeof tokenOrOptions === 'string'
      ? { token: tokenOrOptions }
      : tokenOrOptions;
  const {
    token,
    store,
    agentManager,
    vectorStore,
    cronRunner,
    channelManager,
    configManager,
    laneQueue,
    hybridSearcher,
    memoryExtractor,
    userMdRenderer,
    skillDiscoverer,
    memoryMonitor,
  } = options;

  const app = new Hono();

  // CORS — 仅允许 localhost
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return '*';
        const url = new URL(origin);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
          ? origin
          : '';
      },
    }),
  );

  // 请求/响应日志
  const httpLog = createLogger('http');
  app.use('*', async (c, next) => {
    const start = Date.now();
    const { method, path } = c.req;
    const isHealth = path === '/health';

    // 请求参数
    if (!isHealth) {
      const query = c.req.query();
      const queryStr = Object.keys(query).length
        ? ` query=${JSON.stringify(query)}`
        : '';
      // 请求体仅在 debug 级别记录（避免日志暴涨）
      let bodyStr = '';
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        try {
          const cloned = c.req.raw.clone();
          const text = await cloned.text();
          if (text) {
            const sanitized = text.replace(
              /"(apiKey|api_key|token|secret|password)"\s*:\s*"[^"]*"/gi,
              (_, key) => `"${key}":"***"`,
            );
            bodyStr = ` body=${sanitized.length > 500 ? sanitized.slice(0, 500) + '...' : sanitized}`;
          }
        } catch {
          /* 读取失败忽略 */
        }
      }
      httpLog.info(`--> ${method} ${path}${queryStr}`);
      if (bodyStr) httpLog.debug(`    请求体${bodyStr}`);
    } else {
      httpLog.debug(`--> ${method} ${path}`);
    }

    await next();

    const ms = Date.now() - start;
    const status = c.res.status;

    // 响应：仅记录状态码和耗时，body 仅 debug 级别
    if (!isHealth) {
      httpLog.info(`<-- ${method} ${path} ${status} ${ms}ms`);
      // 响应体仅 debug 级别记录（避免大响应撑爆日志）
      try {
        const cloned = c.res.clone();
        const text = await cloned.text();
        if (text && text.length < 2000) {
          const sanitized = text.replace(
            /"(apiKey|api_key|token|secret|password)"\s*:\s*"[^"]*"/gi,
            (_, key) => `"${key}":"***"`,
          );
          httpLog.debug(`    响应体 body=${sanitized.length > 500 ? sanitized.slice(0, 500) + '...' : sanitized}`);
        }
      } catch {
        /* 流式响应等无法读取，忽略 */
      }
    } else {
      httpLog.debug(`<-- ${method} ${path} ${status} ${ms}ms`);
    }
  });

  // 健康检查 — 无需认证，返回配置状态
  app.get('/health', (c) => {
    const validation = configManager?.validate();
    const status = validation?.valid !== false ? 'ok' : 'needs-setup';
    return c.json({
      status,
      timestamp: Date.now(),
      ...(validation && !validation.valid
        ? { missing: validation.missing }
        : {}),
      ...(validation?.warnings?.length
        ? { warnings: validation.warnings }
        : {}),
    });
  });

  // Bearer Token 认证 — 跳过 /health 路径
  app.use('/*', async (c, next) => {
    if (c.req.path === '/health') return next();
    return bearerAuth({ token })(c, next);
  });

  // 挂载配置路由
  if (configManager) {
    app.route('/config', createConfigRoutes(configManager));
  }

  // 挂载业务路由
  if (agentManager) {
    // 构建 LLM 生成函数：引导式创建 Agent 时用于生成工作区文件
    const llmGenerateFn = configManager
      ? (systemPrompt: string, userMessage: string) =>
          callLLM(configManager, { systemPrompt, userMessage })
      : undefined;
    app.route('/agents', createAgentRoutes(agentManager, llmGenerateFn));
  }
  if (store && agentManager) {
    app.route(
      '/chat',
      createChatRoutes(store, agentManager, vectorStore, configManager, laneQueue, hybridSearcher, memoryExtractor, userMdRenderer, skillDiscoverer),
    );
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
    app.route('/provider', createProviderRoutes(store, configManager));
    if (cronRunner) {
      app.route('/cron', createCronRoutes(cronRunner));
    }
    app.route('/binding', createBindingRoutes(store));
    if (channelManager) {
      app.route('/channel', createChannelRoutes(channelManager));
    }
  }

  // Doctor 自诊断 — 无需 store/agent，始终可用
  app.route('/doctor', createDoctorRoutes(store, configManager, laneQueue, memoryMonitor));

  // 全局错误处理
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    const serverLog = createLogger('server');
    serverLog.error('Unhandled error:', err);
    return c.json({ error: err.message }, 500);
  });

  // 404 处理
  app.notFound((c) => c.json({ error: 'Not Found' }, 404));

  return app;
}

/** 已知 Provider 的友好名称 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  glm: '智谱 GLM',
  doubao: '字节豆包',
  minimax: 'MiniMax',
  kimi: 'Kimi (Moonshot)',
};

/** 从 evo_claw.json 同步 Provider 到内存注册表 */
function syncProvidersFromConfig(configManager: ConfigManager): void {
  const config = configManager.getConfig();
  const providers = config.models?.providers;
  if (!providers) return;

  const log = createLogger('server');

  for (const [id, entry] of Object.entries(providers)) {
    registerProvider({
      id,
      name: PROVIDER_DISPLAY_NAMES[id] ?? id,
      baseUrl: entry.baseUrl,
      apiKeyRef: entry.apiKey,
      models: entry.models.map((m) => ({
        id: m.id,
        name: m.name,
        provider: id,
        maxContextLength: m.contextWindow ?? 128000,
        maxOutputTokens: m.maxTokens ?? 4096,
        supportsVision: m.input?.includes('image') ?? false,
        supportsToolUse: true,
        isDefault: false,
      })),
    });
    log.info(`Provider 已注册: ${id}`);
  }
}

/** 根据 ConfigManager 初始化 VectorStore */
function initVectorStore(
  db: SqliteStore,
  configManager: ConfigManager,
): VectorStore {
  const embeddingRef = configManager.getEmbeddingModelRef();
  const embeddingApiKey = configManager.getEmbeddingApiKey();
  const embeddingBaseUrl = configManager.getEmbeddingBaseUrl();
  const embeddingModel = configManager.getEmbeddingModel();

  if (embeddingApiKey && embeddingBaseUrl && embeddingRef && embeddingModel) {
    const provider = createEmbeddingProvider(
      embeddingBaseUrl,
      embeddingApiKey,
      embeddingRef.provider,
      embeddingRef.modelId,
      embeddingModel.dimension,
    );
    const embeddingFn = (text: string) => provider.generate(text);
    return new VectorStore(db, embeddingFn);
  }

  return new VectorStore(db);
}

/** 主入口 — 仅在直接执行时运行 */
async function main() {
  const log = createLogger('server');
  const token = generateToken();
  const port = getRandomPort();

  log.info(`日志文件: ${LOG_PATH}`);

  // 初始化配置管理器
  const configManager = new ConfigManager();

  // 从 evo_claw.json 同步 Provider 到内存注册表
  syncProvidersFromConfig(configManager);

  // 初始化数据库
  const db = new SqliteStore();
  const migrationRunner = new MigrationRunner(db);
  await migrationRunner.run();
  log.info('数据库迁移完成');

  // 初始化 VectorStore（从 evo_claw.json 读取配置）
  const vectorStore = initVectorStore(db, configManager);

  // 初始化记忆系统（完整版：FTS + 向量 + 知识图谱 + 记忆提取）
  const memoryStore = new MemoryStore(db, vectorStore);
  const knowledgeGraph = new KnowledgeGraphStore(db);
  const ftsStore = new FtsStore(db);
  const hybridSearcher = new HybridSearcher(ftsStore, vectorStore, knowledgeGraph, memoryStore);

  // 记忆提取器（需要 LLM + VectorStore + FtsStore 索引）
  const memoryExtractor = new MemoryExtractor(
    db,
    async (system: string, user: string) => callLLM(configManager, { systemPrompt: system, userMessage: user }),
    vectorStore,
    ftsStore,
  );

  // USER.md / MEMORY.md 动态渲染器
  const userMdRenderer = new UserMdRenderer(db);

  // Skill 发现器（用于能力缺口检测 + Skill 推荐）
  const skillDiscoverer = new SkillDiscoverer();

  log.info(`记忆系统已初始化 (向量搜索: ${vectorStore.hasEmbeddingFn ? '已启用' : '降级为 FTS 纯文本'})`);

  const agentManager = new AgentManager(db);

  // 初始化 LaneQueue + CronRunner
  const laneQueue = new LaneQueue();
  const cronRunner = new CronRunner(db, laneQueue);
  cronRunner.start();
  log.info('CronRunner 已启动');

  // 初始化 ChannelManager + Desktop 适配器
  const channelManager = new ChannelManager();
  const desktopAdapter = new DesktopAdapter();
  channelManager.registerAdapter(desktopAdapter);
  desktopAdapter.connect({ type: 'local', name: '桌面', credentials: {} });
  log.info('ChannelManager 已初始化');

  // 内存监控
  const memoryMonitor = new MemoryMonitor();
  memoryMonitor.start();
  log.info('MemoryMonitor 已启动');

  const app = createApp({
    token,
    store: db,
    agentManager,
    vectorStore,
    cronRunner,
    channelManager,
    configManager,
    laneQueue,
    hybridSearcher,
    memoryExtractor,
    userMdRenderer,
    skillDiscoverer,
    memoryMonitor,
  });

  // 进程退出时清理
  const cleanup = () => {
    log.info('正在关闭服务...');
    memoryMonitor.stop();
    cronRunner.stop();
    channelManager.disconnectAll();
    closeLogger();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
    // 首行 JSON — Tauri sidecar.rs 解析此行获取连接信息，必须保持 console.log
    console.log(JSON.stringify({ port: info.port, token }));
    log.info(`服务已启动 port=${info.port}`);
  });
}

// 仅当此文件为入口点时自动启动
const isMainModule =
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.cjs') ||
  process.argv[1]?.endsWith('server.js') ||
  process.argv[1]?.endsWith('server.mjs');

if (isMainModule) {
  main().catch((err) => {
    const log = createLogger('server');
    log.error('启动失败', err);
    process.exit(1);
  });
}
