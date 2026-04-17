import { Hono } from 'hono';
import { isBun } from './infrastructure/runtime.js';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PORT_RANGE, TOKEN_BYTES, DEFAULT_DATA_DIR, BRAND } from '@evoclaw/shared';
import { SqliteStore } from './infrastructure/db/sqlite-store.js';
import { MigrationRunner } from './infrastructure/db/migration-runner.js';
import { ConfigManager } from './infrastructure/config-manager.js';
import { AgentManager } from './agent/agent-manager.js';
import { createAgentRoutes } from './routes/agents.js';
import { createChatRoutes } from './routes/chat.js';
import { createMemoryRoutes } from './routes/memory.js';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createSecurityRoutes } from './routes/security.js';
import { createSecurityPolicyRoutes } from './routes/security-policy.js';
import { createExtensionPackRoutes } from './routes/extension-pack-routes.js';
import { createKnowledgeRoutes } from './routes/knowledge.js';
import { createSopRoutes } from './routes/sop.js';
import { SopDocStore } from './sop/sop-doc-store.js';
import { SopTagStore } from './sop/sop-tag-store.js';
import { VectorStore } from './infrastructure/db/vector-store.js';
import { createEmbeddingProvider } from './rag/embedding-provider.js';
import { createSkillRoutes } from './routes/skill.js';
import { createEvolutionRoutes } from './routes/evolution.js';
import { createProviderRoutes } from './routes/provider.js';
import { createConfigRoutes } from './routes/config.js';
import { createCronRoutes } from './routes/cron.js';
import { createSystemEventRoutes } from './routes/system-events.js';
import { createTaskRoutes } from './routes/tasks.js';
import { CronRunner } from './scheduler/cron-runner.js';
import { LaneQueue } from './agent/lane-queue.js';
import { HeartbeatManager } from './scheduler/heartbeat-manager.js';
import { createHeartbeatExecuteFn } from './scheduler/heartbeat-execute.js';
import { ChannelManager } from './channel/channel-manager.js';
import { DesktopAdapter } from './channel/adapters/desktop.js';
import { ChannelStateRepo } from './channel/channel-state-repo.js';
import { createChannelRoutes } from './routes/channel.js';
import { createBindingRoutes } from './routes/binding.js';
import { BindingRouter } from './routing/binding-router.js';
import { generateSessionKey } from './routing/session-key.js';
import { handleChannelMessage } from './routes/channel-message-handler.js';
import type { ChannelMessageDeps } from './routes/channel-message-handler.js';
import { CommandRegistry } from './channel/command/command-registry.js';
import { createOpenApiRoutes } from './routes/openapi.js';
import { createCommandsRoutes } from './routes/commands.js';
import { createCommandDispatcher, isSlashCommand } from './channel/command/command-dispatcher.js';
import { echoCommand } from './channel/command/builtin/echo.js';
import { debugCommand } from './channel/command/builtin/debug.js';
import { createHelpCommand } from './channel/command/builtin/help.js';
import { costCommand } from './channel/command/builtin/cost.js';
import { modelCommand } from './channel/command/builtin/model.js';
import { memoryCommand } from './channel/command/builtin/memory.js';
import { rememberCommand } from './channel/command/builtin/remember.js';
import { forgetCommand } from './channel/command/builtin/forget.js';
import { statusCommand } from './channel/command/builtin/status.js';
import { createDoctorRoutes } from './routes/doctor.js';
import { MemoryMonitor } from './infrastructure/memory-monitor.js';
import {
  createLogger,
  closeLogger,
  LOG_PATH,
} from './infrastructure/logger.js';
import { callLLM, callLLMSecondaryCached } from './agent/llm-client.js';
import { registerProvider, registerFromExtension } from './provider/provider-registry.js';
import { getProviderExtension } from './provider/extensions/index.js';
import { HybridSearcher } from './memory/hybrid-searcher.js';
import { MemoryExtractor } from './memory/memory-extractor.js';
import { DecayScheduler } from './memory/decay-scheduler.js';
import { MemoryConsolidator } from './memory/memory-consolidator.js';
import { CostTracker } from './cost/cost-tracker.js';
import { createUsageRoutes } from './routes/usage.js';
import { SessionSummarizer } from './memory/session-summarizer.js';
import { LlmReranker } from './memory/llm-reranker.js';
import { UserMdRenderer } from './memory/user-md-renderer.js';
import { SkillDiscoverer } from './skill/skill-discoverer.js';
import { MemoryStore } from './memory/memory-store.js';
import { KnowledgeGraphStore } from './memory/knowledge-graph.js';
import { FtsStore } from './infrastructure/db/fts-store.js';
import { StartupProfiler } from './infrastructure/startup-profiler.js';
import { BootstrapState } from './infrastructure/bootstrap-state.js';
import { Feature } from './infrastructure/feature.js';
import { preconnectProviders } from './infrastructure/preconnect.js';

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

// SIGTERM/SIGINT 由 graceful-shutdown 模块统一管理（在 server 启动后安装）

/** MCP Manager — 异步初始化，通过 getter 延迟获取（模块作用域供 createApp 闭包访问） */
let sharedMcpManager: import('./mcp/mcp-client.js').McpManager | undefined;

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
  /** 记忆系统：记忆存储（供 LLM 工具直写 DB） */
  memoryStore?: import('./memory/memory-store.js').MemoryStore;
  /** 记忆系统：FTS5 全文索引（供 memory_forget_topic 工具按关键字检索） */
  ftsStore?: import('./infrastructure/db/fts-store.js').FtsStore;
  /** 记忆系统：知识图谱存储 */
  knowledgeGraph?: import('./memory/knowledge-graph.js').KnowledgeGraphStore;
  /** USER.md / MEMORY.md 动态渲染器 */
  userMdRenderer?: UserMdRenderer;
  /** Skill 发现器 */
  skillDiscoverer?: SkillDiscoverer;
  /** 内存监控 */
  memoryMonitor?: MemoryMonitor;
  /** Binding 路由器 — Channel → Agent 绑定匹配 */
  bindingRouter?: BindingRouter;
  /** Channel 状态持久化 */
  channelStateRepo?: ChannelStateRepo;
  /** 会话摘要器 */
  sessionSummarizer?: SessionSummarizer;
  /** Heartbeat 管理器（延迟获取，因 HTTP 就绪后才初始化） */
  getHeartbeatManager?: () => HeartbeatManager | undefined;
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
    memoryStore,
    ftsStore,
    knowledgeGraph,
    userMdRenderer,
    skillDiscoverer,
    memoryMonitor,
    bindingRouter,
    channelStateRepo,
    sessionSummarizer,
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

  // Liveness 探针 — 零依赖，Docker/K8s 用
  app.get('/healthz', (c) => c.json({ status: 'alive', uptime: process.uptime() }));

  // Readiness 探针 — 检查子系统就绪状态
  app.get('/readyz', (c) => {
    const checks: Record<string, boolean> = {
      db: !!store,
      config: configManager?.validate()?.valid !== false,
      agents: !!agentManager,
    };
    const ready = Object.values(checks).every(Boolean);
    return c.json({ status: ready ? 'ready' : 'not-ready', checks }, ready ? 200 : 503);
  });

  // Bearer Token 认证 — 跳过健康探针和 /events（SSE 用 query param 验证）
  app.use('/*', async (c, next) => {
    if (c.req.path === '/health' || c.req.path === '/healthz' || c.req.path === '/readyz') return next();
    if (c.req.path === '/events') {
      // SSE 端点：EventSource 不支持 Authorization header，用 query param 验证
      const queryToken = c.req.query('token');
      if (queryToken === token) return next();
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return bearerAuth({ token })(c, next);
  });

  // 挂载配置路由
  if (configManager) {
    app.route('/config', createConfigRoutes(configManager));
  }

  // 成本追踪器实例（跨路由共享）
  const costTrackerInstance = store ? new CostTracker(store) : undefined;

  // 挂载业务路由
  if (agentManager) {
    // 构建 LLM 生成函数：引导式创建 Agent 时用于生成工作区文件
    const llmGenerateFn = configManager
      ? (systemPrompt: string, userMessage: string) =>
          callLLM(configManager, { systemPrompt, userMessage })
      : undefined;
    app.route('/agents', createAgentRoutes(agentManager, llmGenerateFn, store));
  }
  if (store && agentManager) {
    app.route(
      '/chat',
      createChatRoutes(store, agentManager, vectorStore, configManager, laneQueue, hybridSearcher, memoryExtractor, userMdRenderer, skillDiscoverer, cronRunner, costTrackerInstance, sessionSummarizer, () => sharedMcpManager, memoryStore, ftsStore, knowledgeGraph),
    );
    // 反馈路由挂载到 /chat，与聊天路由共用前缀
    app.route('/chat', createFeedbackRoutes(store));
  }
  if (store) {
    if (costTrackerInstance) {
      app.route('/usage', createUsageRoutes(costTrackerInstance));
    }
    app.route('/memory', createMemoryRoutes(store, vectorStore));
    app.route('/security', createSecurityRoutes(store));
    if (configManager) {
      app.route('/security/policy', createSecurityPolicyRoutes(configManager));
      app.route('/extension-packs', createExtensionPackRoutes(configManager));
    }
    if (vectorStore) {
      app.route('/knowledge', createKnowledgeRoutes(store, vectorStore));
    }
    app.route('/skill', createSkillRoutes({
      getPolicyOverride: () => configManager?.getConfig()?.security?.skillInstallPolicy,
    }));
    if (Feature.MCP && (options as any).mcpManager && (options as any).createMcpRoutes) {
      app.route('/mcp', (options as any).createMcpRoutes((options as any).mcpManager));
    }
    app.route('/evolution', createEvolutionRoutes({ db: store, getHeartbeatManager: options.getHeartbeatManager }));
    app.route('/provider', createProviderRoutes(store, configManager));
    if (cronRunner) {
      app.route('/cron', createCronRoutes(cronRunner));
    }
    app.route('/system-events', createSystemEventRoutes());
    app.route('/tasks', createTaskRoutes());
    app.route('/binding', createBindingRoutes(store));
    // SOP 标签设计临时功能 — 文件存储，独立于知识库
    // /draft/generate 走单次 callLLM 调用（非流式、非 agent loop），避免 60s auto-background 与 idleTimeout 切流
    // timeoutMs 设 5 分钟：reasoning 模型（GLM-5/Claude thinking）+ 大段 JSON 输出，
    // 默认 60s 不够。Bun.serve idleTimeout 已设 255s，前端 fetch 无超时，全链路放行。
    const sopLlmCall = configManager
      ? (system: string, user: string) => callLLM(configManager, {
          systemPrompt: system,
          userMessage: user,
          maxTokens: 8192,
          timeoutMs: 300_000,
        })
      : undefined;
    app.route('/sop', createSopRoutes({
      docStore: new SopDocStore(),
      tagStore: new SopTagStore(),
      llmCall: sopLlmCall,
    }));
    if (channelManager) {
      app.route('/channel', createChannelRoutes(channelManager, bindingRouter, channelStateRepo));
    }
  }

  // Doctor 自诊断 — 无需 store/agent，始终可用
  app.route('/doctor', createDoctorRoutes(store, configManager, laneQueue, memoryMonitor));

  // OpenAPI 3.0 文档（M3-T3b）— 从 ROUTE_MANIFEST 静态生成
  app.route('/openapi.json', createOpenApiRoutes());

  // SSE 事件推送 — 前端通过 EventSource 监听实时事件
  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      const { serverEventBus } = await import('./infrastructure/event-bus.js');

      const handler = (event: { type: string; data?: Record<string, unknown> }) => {
        stream.writeSSE({ event: event.type, data: JSON.stringify(event.data ?? {}) })
          .catch(() => { /* 连接已关闭 */ });
      };

      serverEventBus.on('server-event', handler);

      // 保持连接直到客户端断开
      try {
        // 发送心跳防止连接超时
        while (true) {
          await stream.writeSSE({ event: 'ping', data: '' });
          await stream.sleep(30_000);
        }
      } finally {
        serverEventBus.off('server-event', handler);
      }
    });
  });

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
    // 优先从 extension 预设加载模型（确保参数准确）
    const ext = getProviderExtension(id);
    if (ext) {
      registerFromExtension(id, entry.apiKey, entry.baseUrl);

      // 如果 config 中的模型列表为空，从 extension 持久化回 config
      if (!entry.models || entry.models.length === 0) {
        entry.models = ext.models.map(m => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          input: m.input as string[],
          ...(m.dimension ? { dimension: m.dimension } : {}),
        }));
        configManager.setProvider(id, entry);
      }
    } else {
      // 无预设的自定义 provider，从 config 加载
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
    }
    log.info(`Provider 已注册: ${id} (${ext ? 'extension' : 'config'})`);
  }
}

/** 从 evo_claw.json 同步环境变量到 process.env（供 Skill/工具读取） */
function syncEnvVarsFromConfig(configManager: ConfigManager): void {
  const log = createLogger('server');
  const config = configManager.getConfig();
  let count = 0;

  // 品牌默认环境变量（优先级最低，不覆盖已有值）
  if (BRAND.defaultEnv) {
    for (const [key, value] of Object.entries(BRAND.defaultEnv)) {
      if (value && !process.env[key]) {
        process.env[key] = value;
        count++;
      }
    }
  }

  // 新格式: envVars
  if (config.envVars) {
    for (const [key, value] of Object.entries(config.envVars)) {
      if (value) {
        process.env[key] = value;
        count++;
      }
    }
  }

  // 向后兼容: 旧 services.brave.apiKey
  if (config.services?.brave?.apiKey && !process.env.BRAVE_API_KEY) {
    process.env.BRAVE_API_KEY = config.services.brave.apiKey;
    count++;
  }

  // 自动同步 LLM provider API Key 到 process.env（供 Skill 读取）
  const providerEnvMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    kimi: 'MOONSHOT_API_KEY',
    qwen: 'DASHSCOPE_API_KEY',
    glm: 'ZHIPU_API_KEY',
  };
  const providers = config.models?.providers;
  if (providers) {
    for (const [id, entry] of Object.entries(providers)) {
      const envName = providerEnvMap[id];
      if (envName && entry.apiKey && !process.env[envName]) {
        process.env[envName] = entry.apiKey;
        count++;
      }
    }
  }

  if (count > 0) {
    log.info(`环境变量已注入: ${count} 个`);
  }
}

/** 预装 Bundled Skills — 首次启动时复制到 skills 目录 */
function seedBundledSkills(): void {
  const log = createLogger('server');

  const skillsDir = path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');
  // bundled 目录查找：向上遍历找项目根（含 pnpm-workspace.yaml），再定位 packages/core/src/skill/bundled
  let searchDir = typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : path.dirname(new URL(import.meta.url).pathname);
  let bundledDir: string | undefined;

  // 先检查同级 skill/bundled（build 产物）
  const distBundled = path.join(searchDir, 'skill', 'bundled');
  if (fs.existsSync(distBundled)) {
    bundledDir = distBundled;
  } else {
    // 向上找项目根目录（包含 pnpm-workspace.yaml 的目录）
    let dir = searchDir;
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
        const srcBundled = path.join(dir, 'packages', 'core', 'src', 'skill', 'bundled');
        if (fs.existsSync(srcBundled)) {
          bundledDir = srcBundled;
        }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  if (!bundledDir) {
    log.warn(`Bundled skills 目录未找到（从 ${searchDir} 向上查找）`);
    return;
  }

  // 确保 skills 目录存在
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  let seeded = 0;
  for (const skillName of fs.readdirSync(bundledDir)) {
    const srcDir = path.join(bundledDir, skillName);
    if (!fs.statSync(srcDir).isDirectory()) continue;

    const targetDir = path.join(skillsDir, skillName);
    // 已存在则跳过（用户可能修改过或已手动安装）
    if (fs.existsSync(targetDir)) continue;

    fs.cpSync(srcDir, targetDir, { recursive: true });
    seeded++;
  }

  if (seeded > 0) {
    log.info(`已预装 ${seeded} 个 Bundled Skills`);
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
  const profiler = new StartupProfiler();
  profiler.checkpoint('main_start');

  const log = createLogger('server');
  const bootstrapState = new BootstrapState();
  bootstrapState.transition('initializing');

  const token = generateToken();
  const port = getRandomPort();
  log.info(`日志文件: ${LOG_PATH}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1（真正并行）: Config 加载 + DB 初始化 + Skills 预装
  // 三路 Promise.all — Config/DB/Skills 互不依赖，同时执行
  // ═══════════════════════════════════════════════════════════════════════

  const [configManager, db] = await Promise.all([
    // Group A: Config 加载 + Provider 注册（同步，但包装为 async 参与并行）
    (async () => {
      const cm = new ConfigManager();
      syncProvidersFromConfig(cm);
      syncEnvVarsFromConfig(cm);
      profiler.checkpoint('config_loaded');
      return cm;
    })(),
    // Group B: 数据库初始化 + 迁移（耗时最长 ~50-100ms）
    (async () => {
      const store = new SqliteStore();
      const migrationRunner = new MigrationRunner(store);
      await migrationRunner.run();
      profiler.checkpoint('db_ready');
      return store;
    })(),
    // Group C: Skills 预装（独立 I/O）
    new Promise<void>((resolve) => {
      queueMicrotask(() => { seedBundledSkills(); resolve(); });
    }),
  ]);

  log.info('Phase 1 完成: Config + DB + Skills 并行初始化');

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2（真正并行）: Memory 系统 + Agent 系统 + Channel 系统
  // 三路 Promise.all — 都依赖 Phase 1 的 DB + Config，但彼此独立
  // ═══════════════════════════════════════════════════════════════════════

  const llmCallFn = async (system: string, user: string) => callLLM(configManager, { systemPrompt: system, userMessage: user });

  const [memorySys, agentSys, channelSys] = await Promise.all([
    // Group A: Memory 子系统
    (async () => {
      const vectorStore = initVectorStore(db, configManager);
      const memoryStore = new MemoryStore(db, vectorStore);
      const knowledgeGraph = new KnowledgeGraphStore(db);
      const ftsStore = new FtsStore(db);
      const llmReranker = new LlmReranker(llmCallFn);
      const hybridSearcher = new HybridSearcher(ftsStore, vectorStore, knowledgeGraph, memoryStore, llmReranker);
      const memoryExtractor = new MemoryExtractor(db, llmCallFn, vectorStore, ftsStore);
      const sessionSummarizer = new SessionSummarizer(db, llmCallFn);
      const userMdRenderer = new UserMdRenderer(db);
      const skillDiscoverer = new SkillDiscoverer();
      profiler.checkpoint('memory_ready');
      log.info(`记忆系统已初始化 (向量搜索: ${vectorStore.hasEmbeddingFn ? '已启用' : '降级为 FTS 纯文本'})`);
      return { vectorStore, memoryStore, ftsStore, knowledgeGraph, hybridSearcher, memoryExtractor, sessionSummarizer, userMdRenderer, skillDiscoverer };
    })(),

    // Group B: Agent + Scheduler（CronRunner.start() 延迟到 Phase 3）
    (async () => {
      const agentManager = new AgentManager(db);
      const laneQueue = new LaneQueue();
      const cronRunner = new CronRunner(db, laneQueue);
      profiler.checkpoint('agent_ready');
      return { agentManager, laneQueue, cronRunner };
    })(),

    // Group C: Channel 子系统（含 WeixinAdapter 动态导入，与其他构造并行）
    (async () => {
      const channelManager = new ChannelManager();
      const desktopAdapter = new DesktopAdapter();
      channelManager.registerAdapter(desktopAdapter);
      desktopAdapter.connect({ type: 'local', name: '桌面', credentials: {} });
      const channelStateRepo = new ChannelStateRepo(db);
      if (Feature.WEIXIN) {
        const { WeixinAdapter } = await import('./channel/adapters/weixin.js');
        const weixinAdapter = new WeixinAdapter(channelStateRepo);
        channelManager.registerAdapter(weixinAdapter);
      }
      const bindingRouter = new BindingRouter(db);
      profiler.checkpoint('channel_ready');
      return { channelManager, channelStateRepo, bindingRouter };
    })(),
  ]);

  // 解构并行结果
  const { vectorStore, memoryStore, ftsStore, knowledgeGraph, hybridSearcher, memoryExtractor, sessionSummarizer, userMdRenderer, skillDiscoverer } = memorySys;
  const { agentManager, laneQueue, cronRunner } = agentSys;
  const { channelManager, channelStateRepo, bindingRouter } = channelSys;

  profiler.checkpoint('systems_ready');

  // HeartbeatManager — 延迟到 HTTP 服务就绪后初始化（需要实际 port）
  let heartbeatManager: HeartbeatManager | null = null;

  // --- 渠道命令系统 ---
  const commandRegistry = new CommandRegistry();
  commandRegistry.register(echoCommand);
  commandRegistry.register(debugCommand);
  commandRegistry.register(costCommand);
  commandRegistry.register(modelCommand);
  commandRegistry.register(memoryCommand);
  commandRegistry.register(rememberCommand);
  commandRegistry.register(forgetCommand);
  commandRegistry.register(statusCommand);
  commandRegistry.register(createHelpCommand(commandRegistry));

  const dispatchCommand = createCommandDispatcher(commandRegistry);

  // 渠道消息处理依赖
  const channelMsgDeps: ChannelMessageDeps = {
    store: db,
    agentManager,
    channelManager,
    configManager,
    vectorStore,
    hybridSearcher,
    memoryExtractor,
    userMdRenderer,
    skillDiscoverer,
    laneQueue,
    memoryStore,
    ftsStore,
    knowledgeGraph,
  };

  // 注册全局消息回调 — 从 IM 渠道收到消息后路由到对应 Agent 处理
  channelManager.onMessage(async (msg) => {
    const targetAgentId = bindingRouter.resolveAgent({
      channel: msg.channel,
      accountId: msg.accountId,
      peerId: msg.peerId,
    });
    if (!targetAgentId) {
      log.warn(`渠道消息无路由: channel=${msg.channel} peer=${msg.peerId}`);
      return;
    }

    // --- 渠道命令拦截 ---
    if (isSlashCommand(msg.content)) {
      const cmdCtx = {
        agentId: targetAgentId,
        channel: msg.channel,
        peerId: msg.peerId,
        senderId: msg.senderId,
        accountId: msg.accountId,
        store: db,
        agentManager,
        channelManager,
        configManager,
        stateRepo: channelStateRepo,
        skillDiscoverer,
      };

      const result = await dispatchCommand(msg.content, cmdCtx);
      if (result.handled) {
        if (result.injectToConversation) {
          // 技能 fallback — 转为自然语言传给 AI
          const skillMessage = result.skillArgs
            ? `请执行技能 ${result.skillName}，参数: ${result.skillArgs}`
            : `请执行技能 ${result.skillName}`;

          const chatTypeForKey = msg.chatType === 'group' ? 'group' : 'direct';
          const sessionKey = generateSessionKey(targetAgentId, msg.channel, chatTypeForKey, msg.peerId);

          try {
            await handleChannelMessage(
              {
                agentId: targetAgentId,
                sessionKey,
                message: skillMessage,
                channel: msg.channel,
                peerId: msg.peerId,
                chatType: msg.chatType,
                mediaPath: msg.mediaPath,
                mediaType: msg.mediaType,
              },
              channelMsgDeps,
            );
          } catch (err) {
            log.error(`技能 fallback 处理失败: ${err}`);
          }
          return;
        }

        // 内置命令 — 直接回复
        if (result.response) {
          try {
            await channelManager.sendMessage(msg.channel, msg.peerId, result.response, msg.chatType);
          } catch (err) {
            log.error(`命令回复发送失败: ${err}`);
          }
        }
        return;
      }
    }

    // --- 正常 AI 管线 ---
    const chatTypeForKey = msg.chatType === 'group' ? 'group' : 'direct';
    const sessionKey = generateSessionKey(targetAgentId, msg.channel, chatTypeForKey, msg.peerId);

    try {
      await handleChannelMessage(
        {
          agentId: targetAgentId,
          sessionKey,
          message: msg.content,
          channel: msg.channel,
          peerId: msg.peerId,
          chatType: msg.chatType,
          mediaPath: msg.mediaPath,
          mediaType: msg.mediaType,
        },
        channelMsgDeps,
      );
    } catch (err) {
      log.error(`渠道消息处理失败: ${err}`);
    }
  });

  // 内存监控（start() 延迟到 Phase 3，构造器提前创建供 doctor 路由使用）
  const memoryMonitor = new MemoryMonitor();

  // ═══════════════════════════════════════════════════════════════════════
  // 创建 HTTP 应用 + 启动服务器
  // ═══════════════════════════════════════════════════════════════════════

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
    memoryStore,
    ftsStore,
    knowledgeGraph,
    userMdRenderer,
    skillDiscoverer,
    memoryMonitor,
    bindingRouter,
    channelStateRepo,
    sessionSummarizer,
    getHeartbeatManager: () => heartbeatManager ?? undefined,
  });

  // 命令清单 API（M3-T3b）— 在 app 创建 + commandRegistry 就绪后挂载
  app.route('/commands', createCommandsRoutes(commandRegistry));

  // 延迟初始化的调度器引用（在 cleanup 中关闭）
  let decayScheduler: DecayScheduler | null = null;
  let consolidator: MemoryConsolidator | null = null;

  // 优雅关闭 — 注册各资源的关闭处理器（按优先级执行）
  const { registerShutdownHandler, installShutdownHandlers } = await import('./infrastructure/graceful-shutdown.js');

  registerShutdownHandler({ name: '调度器', priority: 10, handler: () => {
    cronRunner.stop();
    heartbeatManager?.stopAll();
    decayScheduler?.stop();
    consolidator?.stop();
    memoryMonitor.stop();
  }});
  registerShutdownHandler({ name: '渠道', priority: 20, handler: () => { channelManager.disconnectAll(); }});
  // MCP shutdown handler 在 mcpManager 初始化后注册（见 Phase 3a.5）
  if (db) {
    registerShutdownHandler({ name: '数据库', priority: 80, handler: () => { db.close(); }});
  }
  registerShutdownHandler({ name: '日志', priority: 99, handler: () => { closeLogger(); }});

  installShutdownHandlers();

  const startServer = async () => {
    let actualPort = port;
    if (isBun) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { bunSSEResponses } = await import('./routes/chat.js');
      const server = (globalThis as any).Bun.serve({
        async fetch(req: Request) {
          const honoResponse = await app.fetch(req);
          // SSE 绕行: 路由层返回空 dummy Response 给 Hono，实际 SSE Response 存 WeakMap
          // 避免 Hono 中间件 wrap 原始 ReadableStream 导致 stream lock
          if (honoResponse.headers.get('x-sse-bypass') === '1') {
            const sseResponse = bunSSEResponses.get(req);
            if (sseResponse) {
              bunSSEResponses.delete(req);
              return sseResponse;
            }
          }
          return honoResponse;
        },
        port,
        hostname: '127.0.0.1',
        // SSE 流式 chat 端点 + reasoning 模型（GLM-5/Claude thinking 等）首 token 延迟可能 >10s，
        // Bun 默认 idleTimeout=10s 会导致流被切断 → 前端只收到部分事件，agent_done 永远不到。
        // Bun 限制 idleTimeout 上限 255 秒，取最大值。Agent 自身有 90s 看门狗保护，不会真挂死。
        idleTimeout: 255,
      });
      actualPort = server.port;
    } else {
      const { serve } = await import('@hono/node-server');
      await new Promise<void>((resolve) => {
        serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
          actualPort = info.port;
          resolve();
        });
      });
    }
    return actualPort;
  };
  const actualPort = await startServer();

  // 首行 JSON — Tauri sidecar.rs 解析此行获取连接信息，必须保持 console.log
  console.log(JSON.stringify({ port: actualPort, token }));

  profiler.checkpoint('http_listening');
  bootstrapState.transition('ready');
  bootstrapState.setServerInfo(actualPort, token);
  log.info(`服务已启动 port=${actualPort}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3（延迟）: HTTP 就绪后的非阻塞任务
  // 这些操作不影响服务接收请求，异步执行
  // ═══════════════════════════════════════════════════════════════════════

  // 3a. 延迟启动：调度器 + 内存监控（从 Phase 2 移出，不阻塞 HTTP 就绪）
  cronRunner.start();
  memoryMonitor.start();
  log.info('CronRunner + MemoryMonitor 已启动（Phase 3 延迟）');

  // 3a.1. API 预连接 — 提前建立 TCP+TLS，减少首次 LLM 调用延迟
  preconnectProviders(configManager);

  // 3a.2. 活跃 Agent 工作区文件预读 — 减少首次对话的文件 I/O
  (async () => {
    try {
      const agents = agentManager.listAgents('active');
      for (const agent of agents) {
        agentManager.readWorkspaceFile(agent.id, 'SOUL.md');
        agentManager.readWorkspaceFile(agent.id, 'IDENTITY.md');
      }
    } catch { /* 预读失败不影响运行 */ }
  })();

  // 3a.5. MCP 服务器发现 + 安全过滤 + 重连机制（异步，不阻塞）
  if (Feature.MCP) {
    (async () => {
      try {
        const { McpManager } = await import('./mcp/mcp-client.js');
        const { discoverMcpConfigs } = await import('./mcp/mcp-config.js');
        const { applySecurityPolicy } = await import('./mcp/mcp-security.js');

        const mcpManager = new McpManager();
        // 存储到闭包变量，供 getMcpManager getter 访问
        sharedMcpManager = mcpManager;

        // 注册 MCP shutdown handler
        registerShutdownHandler({ name: 'MCP', priority: 30, handler: () => mcpManager.disposeAll() });

        let mcpConfigs = discoverMcpConfigs();
        if (mcpConfigs.length === 0) return;

        // 安全策略过滤
        const mcpPolicy = (configManager.getConfig() as any).mcpSecurity;
        if (mcpPolicy) {
          mcpConfigs = applySecurityPolicy(mcpConfigs, mcpPolicy);
        }

        // 并行连接已启用的服务器（串行→并行，多 MCP 场景大幅提速）
        const enabledConfigs = mcpConfigs.filter((c: { enabled?: boolean }) => c.enabled !== false);
        await Promise.allSettled(
          enabledConfigs.map((config: any) => mcpManager.addServer(config)),
        );

        const states = mcpManager.getStates();
        const running = states.filter((s: { status: string }) => s.status === 'running').length;
        if (running > 0 || enabledConfigs.length > 0) {
          log.info(`MCP: ${running}/${enabledConfigs.length} 服务器已连接, ${mcpManager.getAllTools().length} 个工具`);
        }
        profiler.checkpoint('mcp_ready');
      } catch (err) {
        log.warn(`MCP 初始化失败: ${err instanceof Error ? err.message : err}`);
      }
    })();
  }

  // 3b. Channel 自动恢复（可能涉及网络 I/O，不阻塞服务启动）
  const recoverChannels = async () => {
    const channelTypes = [
      ...(Feature.WEIXIN ? ['weixin' as const] : []),
      ...(Feature.FEISHU ? ['feishu' as const] : []),
      ...(Feature.WECOM ? ['wecom' as const] : []),
    ];
    for (const chType of channelTypes) {
      const savedCreds = channelStateRepo.getState(chType as any, 'credentials');
      const savedName = channelStateRepo.getState(chType as any, 'name');
      if (savedCreds) {
        const hasBinding = db.get<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM bindings WHERE channel = ? OR is_default = 1`,
          chType,
        );
        if (!hasBinding || hasBinding.cnt === 0) {
          log.info(`渠道 ${chType} 无 Agent 绑定，跳过轮询（凭证已保留，绑定后可手动连接）`);
          continue;
        }
        try {
          const credentials = JSON.parse(savedCreds);
          await channelManager.connect({
            type: chType as any,
            name: savedName ?? chType,
            credentials,
          });
          log.info(`渠道 ${chType} 已自动恢复连接`);
        } catch (err) {
          log.warn(`渠道 ${chType} 自动恢复失败: ${err instanceof Error ? err.message : String(err)}`);
          channelStateRepo.deleteState(chType as any, 'credentials');
          channelStateRepo.deleteState(chType as any, 'name');
        }
      }
    }
  };
  recoverChannels().catch(err => log.error('渠道恢复异常', err));

  // 3c. HeartbeatManager（需要实际 port 构建 executeFn）
  const executeFn = createHeartbeatExecuteFn(actualPort, token);

  const onHeartbeatResult: import('./scheduler/heartbeat-runner.js').HeartbeatResultCallback = (
    agentId, result, response, config,
  ) => {
    const target = config.target ?? 'none';
    if (target === 'none') return;

    const shouldDeliver =
      (result === 'ok' && config.showOk) ||
      (result === 'active' && (config.showAlerts ?? true));
    if (!shouldDeliver || !response.trim()) return;

    (async () => {
      try {
        if (target === 'last') {
          const lastSession = db.get<{ session_key: string }>(
            `SELECT session_key FROM conversation_log
             WHERE agent_id = ? AND session_key NOT LIKE '%:local:%' AND session_key NOT LIKE '%:heartbeat%'
             ORDER BY created_at DESC LIMIT 1`,
            agentId,
          );
          if (!lastSession) return;
          const parts = lastSession.session_key.split(':');
          if (parts.length >= 5) {
            await channelManager.sendMessage(parts[2] as any, parts[4], response);
          }
        } else {
          const lastPeer = db.get<{ session_key: string }>(
            `SELECT session_key FROM conversation_log
             WHERE agent_id = ? AND session_key LIKE ?
             ORDER BY created_at DESC LIMIT 1`,
            agentId, `%:${target}:%`,
          );
          if (lastPeer) {
            const parts = lastPeer.session_key.split(':');
            if (parts.length >= 5) {
              await channelManager.sendMessage(target as any, parts[4], response);
            }
          }
        }
      } catch (err) {
        log.error(`Heartbeat 渠道投递失败 agent=${agentId} target=${target}`, err);
      }
    })();
  };

  heartbeatManager = new HeartbeatManager(
    db, executeFn, onHeartbeatResult,
    (agentId, filename) => agentManager.readWorkspaceFile(agentId, filename) ?? null,
  );
  heartbeatManager.startAll();
  log.info('HeartbeatManager 已启动');

  // 3c.5. 记忆衰减调度器 + AutoDream 整合器
  decayScheduler = new DecayScheduler(db);
  decayScheduler.start();

  const memoryDataDir = path.join(os.homedir(), DEFAULT_DATA_DIR);
  // 记忆整合使用 cache 优化的二级模型调用（summarize 类型 → 固定 system prompt → cache 命中）
  const llmCallForConsolidation = (system: string, user: string) =>
    callLLMSecondaryCached(configManager, 'summarize', user, { appendToSystem: system });
  consolidator = new MemoryConsolidator(db, llmCallForConsolidation, memoryDataDir, undefined, ftsStore);
  consolidator.start();
  log.info('DecayScheduler + MemoryConsolidator 已启动');

  // 3d. BOOT.md 启动执行 — 异步，不阻塞
  const activeAgents = agentManager.listAgents('active');
  for (const agent of activeAgents) {
    let bootContent = agentManager.readWorkspaceFile(agent.id, 'BOOT.md');
    if (!bootContent) continue;

    // 剥离 HTML 注释（与 context-assembler 一致）
    bootContent = bootContent.replace(/<!--[\s\S]*?-->/g, '');

    // 跳过空内容（只有空行/标题）
    if (!bootContent.split('\n').some(l => {
      const t = l.trim();
      return t && !t.startsWith('#');
    })) continue;

    const bootSessionKey = `agent:${agent.id}:boot`;
    executeFn(agent.id, bootContent, bootSessionKey).catch(err => {
      log.error(`Agent ${agent.id} BOOT.md 执行失败:`, err);
    });
    log.info(`Agent ${agent.id} BOOT.md 已触发执行`);
  }

  profiler.checkpoint('startup_complete');
  log.info(`启动性能报告:\n${profiler.formatReport()}`);

  // 存入 bootstrapState 供诊断使用
  bootstrapState.set('profiler', profiler);
  bootstrapState.set('db', db);
  bootstrapState.set('configManager', configManager);
  bootstrapState.set('agentManager', agentManager);
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
