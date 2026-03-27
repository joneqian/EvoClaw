import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import crypto from 'node:crypto';
import { AgentManager } from '../agent/agent-manager.js';
import { runEmbeddedAgent } from '../agent/embedded-runner.js';
import type { AgentRunConfig } from '../agent/types.js';
import { lookupModelDefinition } from '../provider/extensions/index.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ChatMessage } from '@evoclaw/shared';
import { ContextEngine } from '../context/context-engine.js';
import { contextAssemblerPlugin } from '../context/plugins/context-assembler.js';
import { sessionRouterPlugin } from '../context/plugins/session-router.js';
import { resolveModel } from '../provider/model-resolver.js';
import { generateSessionKey } from '../routing/session-key.js';
import { setToolInjectorConfig, getInjectedTools, ToolAuditQueue } from '../bridge/tool-injector.js';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createImageTool } from '../tools/image-tool.js';
import { createPdfTool } from '../tools/pdf-tool.js';
import { createApplyPatchTool } from '../tools/apply-patch.js';
import { createSubAgentTools } from '../tools/sub-agent-tools.js';
import { createBrowserTool } from '../tools/browser-tool.js';
import { createImageGenerateTool } from '../tools/image-generate-tool.js';
import { filterToolsByProfile, type ToolProfileId } from '../agent/tool-catalog.js';
import { createExecBackgroundTool, createProcessTool } from '../tools/background-process.js';
import { SubAgentSpawner } from '../agent/sub-agent-spawner.js';
import type { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryExtractor } from '../memory/memory-extractor.js';
import { createMemoryRecallPlugin } from '../context/plugins/memory-recall.js';
import { createMemoryExtractPlugin } from '../context/plugins/memory-extract.js';
import { createToolRegistryPlugin } from '../context/plugins/tool-registry.js';
import { createGapDetectionPlugin } from '../context/plugins/gap-detection.js';
import { SecurityExtension } from '../bridge/security-extension.js';
import { createPermissionPlugin } from '../context/plugins/permission.js';
import { createSecurityPlugin } from '../context/plugins/security.js';
import { PermissionInterceptor } from '../tools/permission-interceptor.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { UserMdRenderer } from '../memory/user-md-renderer.js';
import type { SkillDiscoverer } from '../skill/skill-discoverer.js';
import { parseSessionKey } from '../routing/session-key.js';
import { createLogger } from '../infrastructure/logger.js';
import { emitServerEvent } from '../infrastructure/event-bus.js';

const log = createLogger('chat');

/** apply_patch 仅在 OpenAI 模型时创建（其他模型 diff 格式不兼容） */
const APPLY_PATCH_ALLOWED_PROVIDERS = new Set(['openai', 'openai-completions']);
const APPLY_PATCH_ALLOWED_MODELS = new Set([
  'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4-turbo-preview',
  'gpt-4', 'gpt-4-0125-preview', 'gpt-4-1106-preview',
  'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini',
]);

/** 通道特定的工具禁止规则 */
const CHANNEL_TOOL_DENY: Record<string, string[]> = {
  // 语音通道禁止 TTS（避免循环反馈）
  voice: ['tts'],
};

/** 检测工具名称冲突 */
function detectToolNameConflicts(toolList: { name: string }[]): void {
  const seen = new Map<string, number>();
  for (const tool of toolList) {
    seen.set(tool.name, (seen.get(tool.name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      log.warn(`工具名称冲突: "${name}" 出现 ${count} 次，后注册的将覆盖先注册的`);
    }
  }
}

/** 从 conversation_log 加载最近消息历史 */
function loadMessageHistory(db: SqliteStore, agentId: string, sessionKey: string, limit: number = 20): ChatMessage[] {
  const rows = db.all<{
    id: string;
    session_key: string;
    role: string;
    content: string;
    tool_calls_json: string | null;
    created_at: string;
  }>(
    `SELECT id, session_key, role, content, tool_calls_json, created_at
     FROM conversation_log
     WHERE agent_id = ? AND session_key = ? AND role IN ('user', 'assistant')
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
    agentId, sessionKey, limit,
  );

  // 反转为时间正序
  return rows.reverse().map(row => {
    const msg: ChatMessage = {
      id: row.id,
      conversationId: row.session_key,
      role: row.role as ChatMessage['role'],
      content: row.content,
      createdAt: row.created_at,
    };
    if (row.tool_calls_json) {
      try { (msg as any).toolCalls = JSON.parse(row.tool_calls_json); } catch { /* ignore */ }
    }
    return msg;
  });
}

/** 存储消息到 conversation_log (使用 ISO 格式时间戳，确保前端时区正确) */
function saveMessage(db: SqliteStore, agentId: string, sessionKey: string, role: string, content: string): void {
  db.run(
    `INSERT INTO conversation_log (id, agent_id, session_key, role, content, compaction_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'raw', ?)`,
    crypto.randomUUID(), agentId, sessionKey, role, content, new Date().toISOString(),
  );
}

/** 创建聊天路由 */
export function createChatRoutes(
  store: SqliteStore,
  agentManager: AgentManager,
  vectorStore?: VectorStore,
  configManager?: ConfigManager,
  laneQueue?: LaneQueue,
  hybridSearcher?: HybridSearcher,
  memoryExtractor?: MemoryExtractor,
  userMdRenderer?: UserMdRenderer,
  skillDiscoverer?: SkillDiscoverer,
) {
  const app = new Hono();

  /** GET /recents — 最近会话列表（跨 Agent） */
  app.get('/recents', (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    const rows = store.all<{
      session_key: string;
      agent_id: string;
      last_content: string;
      last_role: string;
      last_at: string;
      msg_count: number;
    }>(
      `SELECT
         session_key,
         agent_id,
         content AS last_content,
         role AS last_role,
         created_at AS last_at,
         cnt AS msg_count
       FROM (
         SELECT cl.*,
           COUNT(*) OVER (PARTITION BY cl.session_key) AS cnt,
           ROW_NUMBER() OVER (PARTITION BY cl.session_key ORDER BY cl.created_at DESC) AS rn
         FROM conversation_log cl
         WHERE cl.role IN ('user', 'assistant')
       ) sub
       WHERE rn = 1
       ORDER BY last_at DESC
       LIMIT ?`,
      limit,
    );

    // 补充 Agent 信息
    const conversations = rows.map((r) => {
      const agent = store.get<{ name: string; emoji: string }>(
        'SELECT name, emoji FROM agents WHERE id = ?',
        r.agent_id,
      );
      // 标题：取第一条用户消息的前 30 字
      const firstUserMsg = store.get<{ content: string }>(
        `SELECT content FROM conversation_log
         WHERE session_key = ? AND role = 'user'
         ORDER BY created_at ASC LIMIT 1`,
        r.session_key,
      );
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')
        : '新对话';
      return {
        sessionKey: r.session_key,
        agentId: r.agent_id,
        agentName: agent?.name ?? '未知',
        agentEmoji: agent?.emoji ?? '🤖',
        title,
        lastAt: r.last_at,
        messageCount: r.msg_count,
      };
    });

    return c.json({ conversations });
  });

  /** GET /:agentId/conversations — 某个 Agent 的所有会话 */
  app.get('/:agentId/conversations', (c) => {
    const agentId = c.req.param('agentId');
    const rows = store.all<{
      session_key: string;
      last_content: string;
      last_at: string;
      msg_count: number;
    }>(
      `SELECT
         session_key,
         content AS last_content,
         created_at AS last_at,
         cnt AS msg_count
       FROM (
         SELECT cl.*,
           COUNT(*) OVER (PARTITION BY cl.session_key) AS cnt,
           ROW_NUMBER() OVER (PARTITION BY cl.session_key ORDER BY cl.created_at DESC) AS rn
         FROM conversation_log cl
         WHERE cl.agent_id = ? AND cl.role IN ('user', 'assistant')
       ) sub
       WHERE rn = 1
       ORDER BY last_at DESC`,
      agentId,
    );

    const conversations = rows.map((r) => {
      const firstUserMsg = store.get<{ content: string }>(
        `SELECT content FROM conversation_log
         WHERE session_key = ? AND role = 'user'
         ORDER BY created_at ASC LIMIT 1`,
        r.session_key,
      );
      const title = firstUserMsg
        ? firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '')
        : '新对话';
      return {
        sessionKey: r.session_key,
        agentId,
        title,
        lastAt: r.last_at,
        messageCount: r.msg_count,
      };
    });

    return c.json({ conversations });
  });

  /** GET /:agentId/messages — 加载某个会话的消息历史 */
  app.get('/:agentId/messages', (c) => {
    const agentId = c.req.param('agentId');
    const sessionKey = c.req.query('sessionKey');
    const limit = Number(c.req.query('limit') ?? '50');

    if (!sessionKey) {
      return c.json({ error: '缺少 sessionKey 参数' }, 400);
    }

    const messages = loadMessageHistory(store, agentId, sessionKey, limit);
    return c.json({ messages });
  });

  /** DELETE /:agentId/conversations — 删除某个会话及关联数据 */
  app.delete('/:agentId/conversations', async (c) => {
    const agentId = c.req.param('agentId');
    const sessionKey = c.req.query('sessionKey');

    if (!sessionKey) {
      return c.json({ error: '缺少 sessionKey 参数' }, 400);
    }

    // 删除对话消息
    store.run(
      `DELETE FROM conversation_log WHERE agent_id = ? AND session_key = ?`,
      agentId, sessionKey,
    );
    // 删除该会话的工具审计记录
    store.run(
      `DELETE FROM tool_audit_log WHERE agent_id = ? AND session_key = ?`,
      agentId, sessionKey,
    );
    // 注意：memory_units.source_session_key 不删除 — 记忆属于 Agent 长期积累

    return c.json({ success: true });
  });

  app.post('/:agentId/send', async (c) => {
    const agentId = c.req.param('agentId');
    type SendBody = { message?: string; sessionKey?: string };
    const body: SendBody = await c.req.json<SendBody>().catch(() => ({}));
    const message = body.message;

    if (!message) {
      return c.json({ error: '消息不能为空' }, 400);
    }

    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    // 更新最近对话时间
    agentManager.touchLastChat(agentId);

    // 生成 Session Key
    const sessionKey = body.sessionKey ?? generateSessionKey(agentId, 'local', 'direct', 'local-user');

    // 解析模型 + API 配置
    let modelId = '';
    let provider = '';
    let apiKey = '';
    let baseUrl = '';
    let apiProtocol = 'openai-completions';

    if (agent.modelId && agent.provider && configManager) {
      // Agent 指定了模型
      modelId = agent.modelId;
      provider = agent.provider;
      const providerEntry = configManager.getProvider(provider);
      if (providerEntry) {
        apiKey = providerEntry.apiKey;
        baseUrl = providerEntry.baseUrl;
        apiProtocol = providerEntry.api;
      }
    }

    // 未解析成功时，从 configManager 读默认模型
    if (!apiKey && configManager) {
      provider = configManager.getDefaultProvider();
      modelId = configManager.getDefaultModelId();
      apiKey = configManager.getDefaultApiKey();
      baseUrl = configManager.getDefaultBaseUrl();
      apiProtocol = configManager.getDefaultApi();
    }

    // 最终兜底：从 model resolver（DB + Registry + Fallback）
    if (!apiKey) {
      const resolved = resolveModel({
        agentModelId: agent.modelId,
        agentProvider: agent.provider,
        store,
      });
      modelId = resolved.modelId;
      provider = resolved.provider;
      baseUrl = resolved.baseUrl || '';
    }

    if (!apiKey) {
      return c.json({ error: '未配置 API Key，请先在设置中配置 LLM Provider' }, 400);
    }

    // 创建 ContextEngine 并注册插件
    const contextEngine = new ContextEngine();

    // 安全检测插件（最高优先级，priority=5）
    contextEngine.register(createSecurityPlugin(store));

    contextEngine.register(sessionRouterPlugin);
    contextEngine.register(contextAssemblerPlugin);

    // 权限检查插件
    const security = new SecurityExtension(store);
    contextEngine.register(createPermissionPlugin(security));

    // 记忆系统插件（有实例时注册，无则降级跳过）
    if (hybridSearcher) {
      contextEngine.register(createMemoryRecallPlugin(hybridSearcher));
    }
    if (memoryExtractor) {
      contextEngine.register(createMemoryExtractPlugin(memoryExtractor));
    }

    // Skill 系统插件（含 Agent 级启用/禁用过滤）
    contextEngine.register(createToolRegistryPlugin({
      getDisabledSkills: (aId) => {
        const rows = store.all<{ skill_name: string }>(
          'SELECT skill_name FROM agent_skills WHERE agent_id = ? AND enabled = 0',
          aId,
        );
        return new Set(rows.map(r => r.skill_name));
      },
    }));                  // Tier 1: <available_skills> 目录注入
    contextEngine.register(createGapDetectionPlugin(skillDiscoverer));   // afterTurn: 能力缺口检测 + Skill 推荐

    // 加载消息历史
    const history = loadMessageHistory(store, agentId, sessionKey);

    // 添加当前用户消息
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: sessionKey,
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    };
    const messages = [...history, userMsg];

    // 获取工作区路径
    const workspacePath = agentManager.getWorkspacePath?.(agentId) ?? '';

    // 执行 ContextEngine bootstrap（首次加载工作区文件）
    await contextEngine.bootstrap({
      agentId,
      sessionKey: sessionKey as any,
      workspacePath,
    });

    // 渲染 USER.md / MEMORY.md 到工作区磁盘（供 contextAssembler 加载）
    if (userMdRenderer) {
      try {
        const userMdContent = userMdRenderer.renderUserMd(agentId);
        agentManager.writeWorkspaceFile(agentId, 'USER.md', userMdContent);
        const memoryMdContent = userMdRenderer.renderMemoryMd(agentId);
        agentManager.writeWorkspaceFile(agentId, 'MEMORY.md', memoryMdContent);
      } catch (err) {
        log.warn('UserMdRenderer 渲染失败，降级跳过:', err);
      }
    }

    // 执行 beforeTurn（记忆召回 + 上下文组装）
    const turnCtx = {
      agentId,
      sessionKey: sessionKey as any,
      messages,
      systemPrompt: '',
      injectedContext: [] as string[],
      estimatedTokens: 0,
      tokenLimit: 128_000,
    };
    await contextEngine.beforeTurn(turnCtx);

    // 组装最终 system prompt
    const systemPrompt = turnCtx.injectedContext.join('\n\n---\n\n');

    // 根据 session 类型选择加载的文件（参考 OpenClaw 的分层策略）
    const ALL_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md'];
    const MINIMAL_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'];
    const HEARTBEAT_FILES = ['HEARTBEAT.md'];

    const isSubAgent = sessionKey.includes(':subagent:');
    const isCron = sessionKey.includes(':cron:');
    const isHeartbeat = sessionKey.includes(':heartbeat:');

    const filesToLoad = isHeartbeat ? HEARTBEAT_FILES : (isSubAgent || isCron) ? MINIMAL_FILES : ALL_FILES;

    const workspaceFiles: Record<string, string> = {};
    for (const file of filesToLoad) {
      const content = agentManager.readWorkspaceFile(agentId, file);
      if (content) workspaceFiles[file] = content;
    }

    // BOOTSTRAP.md 生命周期检测
    const bootstrapSeeded = agentManager.getWorkspaceState(agentId, 'bootstrap_seeded_at');
    const setupCompleted = agentManager.getWorkspaceState(agentId, 'setup_completed_at');

    if (bootstrapSeeded && !setupCompleted) {
      // 检查 BOOTSTRAP.md 是否已被 Agent 删除或清空
      const bootstrapContent = agentManager.readWorkspaceFile(agentId, 'BOOTSTRAP.md');
      const bootstrapDone = !bootstrapContent || bootstrapContent.trim().length === 0 || history.length >= 12;
      if (bootstrapDone) {
        agentManager.setWorkspaceState(agentId, 'setup_completed_at', new Date().toISOString());
        // 清空磁盘上的 BOOTSTRAP.md（无论是 Agent 主动清空还是兜底触发）
        agentManager.writeWorkspaceFile(agentId, 'BOOTSTRAP.md', '');
      }
    }

    // setup 已完成 → 不再注入 BOOTSTRAP.md（出生只有一次）
    if (setupCompleted) {
      delete workspaceFiles['BOOTSTRAP.md'];
    }

    // 构建增强工具集
    const braveApiKey = configManager?.getBraveApiKey() ?? '';
    const providerConfig = { apiKey, provider, modelId, baseUrl, apiProtocol };
    const enhancedTools: ToolDefinition[] = [];

    // Web 工具
    if (braveApiKey) enhancedTools.push(createWebSearchTool({ braveApiKey }));
    enhancedTools.push(createWebFetchTool());

    // 多媒体工具（绕过 PI 直接调用 provider API）
    enhancedTools.push(createImageTool(providerConfig));
    enhancedTools.push(createPdfTool(providerConfig));

    // 高级编辑工具（仅 OpenAI 模型支持 apply_patch diff 格式）
    if (APPLY_PATCH_ALLOWED_PROVIDERS.has(provider) &&
        (APPLY_PATCH_ALLOWED_MODELS.has(modelId) || modelId.startsWith('gpt-4') || modelId.startsWith('o1') || modelId.startsWith('o3'))) {
      enhancedTools.push(createApplyPatchTool());
    }

    // 浏览器工具
    enhancedTools.push(createBrowserTool());

    // 图片生成工具（需要 API Key）
    if (apiKey) {
      enhancedTools.push(createImageGenerateTool({
        apiKey,
        baseUrl: baseUrl || undefined,
        provider,
      }));
    }

    // 进程管理工具
    enhancedTools.push(createExecBackgroundTool());
    enhancedTools.push(createProcessTool());

    // 查 extension 获取模型参数（用于 contextWindow/maxTokens）
    const modelDef = lookupModelDefinition(provider, modelId);

    // 子 Agent 工具（需 laneQueue）
    let spawner: SubAgentSpawner | undefined;
    if (laneQueue) {
      const runConfigForSpawner: AgentRunConfig = {
        agent,
        systemPrompt: '',
        workspaceFiles: {},
        workspacePath: agentManager.getAgentCwd(agentId),
        modelId,
        provider,
        apiKey,
        baseUrl,
        apiProtocol: apiProtocol as AgentRunConfig['apiProtocol'],
        tools: enhancedTools,  // 子 Agent 继承增强工具（不含子 Agent 工具本身）
        contextWindow: modelDef?.contextWindow,
        maxTokens: modelDef?.maxTokens,
      };
      // 跨 Agent 解析器：根据 agentId 查找目标 Agent 配置 + 工作区文件
      const agentResolver = (targetId: string) => {
        const targetAgent = agentManager.getAgent(targetId);
        if (!targetAgent) return undefined;
        const targetWsFiles: Record<string, string> = {};
        for (const file of ['AGENTS.md', 'TOOLS.md', 'SOUL.md', 'IDENTITY.md']) {
          const content = agentManager.readWorkspaceFile(targetId, file);
          if (content) targetWsFiles[file] = content;
        }
        return { agent: targetAgent, workspaceFiles: targetWsFiles };
      };
      spawner = new SubAgentSpawner(runConfigForSpawner, laneQueue, 0, (taskId, task, result, success) => {
        log.info(`子 Agent ${taskId} ${success ? '完成' : '失败'}: ${task.slice(0, 50)}`);
      }, workspaceFiles, agentResolver);
      enhancedTools.push(...createSubAgentTools(spawner));
    }

    // ─── P2-1: Tool Profile 过滤 ───
    const agentProfile = agent.toolProfile as ToolProfileId | undefined;
    if (agentProfile && agentProfile !== 'full') {
      const filtered = filterToolsByProfile(enhancedTools, agentProfile);
      enhancedTools.length = 0;
      enhancedTools.push(...filtered);
    }

    // ─── P2-2: Provider 特定工具禁止列表 ───
    const PROVIDER_TOOL_DENY: Record<string, string[]> = {
      // xAI 模型有原生 web_search → 移除 EvoClaw 的
      'xai': ['web_search'],
    };
    const providerDeny = PROVIDER_TOOL_DENY[provider] ?? [];
    if (providerDeny.length > 0) {
      const denySet = new Set(providerDeny);
      const afterDeny = enhancedTools.filter(t => !denySet.has(t.name));
      enhancedTools.length = 0;
      enhancedTools.push(...afterDeny);
    }

    // ─── P2-7: 通道特定工具禁止 ───
    const channelType = parseSessionKey(sessionKey)?.channel;
    const channelDeny = channelType ? (CHANNEL_TOOL_DENY[channelType] ?? []) : [];
    if (channelDeny.length > 0) {
      const denySet = new Set(channelDeny);
      const afterChannelDeny = enhancedTools.filter(t => !denySet.has(t.name));
      enhancedTools.length = 0;
      enhancedTools.push(...afterChannelDeny);
    }

    // 配置工具注入
    setToolInjectorConfig({ agentId, evoClawTools: enhancedTools });
    const tools = getInjectedTools();

    // ─── P3-4: 工具名称冲突检测 ───
    detectToolNameConflicts(tools);

    // 权限拦截器 — 通过 permissionInterceptFn 传入 embedded-runner，拦截所有工具（含 PI 内置）
    const interceptor = new PermissionInterceptor(
      security,
      (aId) => agentManager.getWorkspacePath(aId),
    );

    // 记录本次对话中需要弹窗的权限请求（流结束后随最后一批 SSE 事件到达前端）
    const pendingPermissions: Array<{
      requestId: string; toolName: string; category: string; resource: string; reason?: string;
    }> = [];

    const permissionInterceptFn = async (toolName: string, args: Record<string, unknown>): Promise<string | null> => {
      const result = interceptor.intercept(agentId, toolName, args);

      if (!result.allowed && result.requiresConfirmation) {
        // 记录待弹窗的权限请求（Tauri WKWebView 不支持 fetch streaming，
        // SSE 事件在流结束后才到达前端，无法阻塞等待用户决策）
        const category = result.permissionCategory ?? 'skill';
        const resource = (args['path'] as string) ?? (args['file_path'] as string) ?? (args['command'] as string) ?? '*';
        pendingPermissions.push({
          requestId: crypto.randomUUID(),
          toolName,
          category,
          resource,
          reason: result.reason,
        });
        // 立即拒绝，提示用户授权后重试
        return `需要「${category}」权限才能执行此操作。请在弹出的权限对话框中授权后重新发送消息。`;
      }

      if (!result.allowed && !result.requiresConfirmation) {
        return result.reason ?? '操作被拒绝';
      }

      return null; // 允许
    };

    const runConfig: AgentRunConfig = {
      agent,
      systemPrompt,
      workspaceFiles,
      workspacePath: agentManager.getAgentCwd(agentId),
      modelId,
      provider,
      apiKey,
      baseUrl,
      apiProtocol: apiProtocol as AgentRunConfig['apiProtocol'],
      tools,
      messages,
      contextWindow: modelDef?.contextWindow,
      maxTokens: modelDef?.maxTokens,
      permissionInterceptFn,
      auditLogFn: (entry) => {
        auditQueue.push({
          agentId,
          sessionKey,
          toolName: entry.toolName,
          inputJson: JSON.stringify(entry.args),
          outputJson: entry.result.slice(0, 5000),
          status: entry.status,
          durationMs: entry.durationMs,
        });
      },
    };

    // 审计日志异步队列（内存缓存 + Agent 结束后批量写入）
    const auditQueue = new ToolAuditQueue(store);

    // 存储用户消息
    saveMessage(store, agentId, sessionKey, 'user', message);

    // 返回 SSE 流
    return streamSSE(c, async (stream) => {
      let fullResponse = '';

      const runAgent = async (abortSignal?: AbortSignal) => {
        await runEmbeddedAgent(runConfig, message, async (event) => {
          if (event.type === 'text_delta' && event.delta) {
            fullResponse += event.delta;
          }
          await stream.writeSSE({ data: JSON.stringify(event) });
        }, abortSignal);
      };

      if (laneQueue) {
        const runId = `chat-${crypto.randomUUID()}`;
        const abortController = new AbortController();

        // SSE 连接关闭时，取消排队/中止运行
        stream.onAbort(() => {
          abortController.abort();
          laneQueue.cancel(runId);
        });

        // 通知前端已入队
        await stream.writeSSE({ data: JSON.stringify({ type: 'queued', timestamp: Date.now() }) });

        await laneQueue.enqueue({
          id: runId,
          sessionKey,
          lane: 'main',
          abortController,
          task: () => runAgent(abortController.signal),
          timeoutMs: 600_000,
        });
      } else {
        await runAgent();
      }

      // 批量写入审计日志（Agent 完成后一次性写入，避免逐条同步 I/O）
      auditQueue.flush();

      // 存储 assistant 响应（剥离 PI 框架内部的工具调用/响应 XML 标记）
      const cleanResponse = fullResponse
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
        .replace(/<function_response>[\s\S]*?<\/function_response>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (cleanResponse) {
        saveMessage(store, agentId, sessionKey, 'assistant', cleanResponse);
      }

      // 通知其他 SSE 监听者（其他页面/窗口）会话已更新
      emitServerEvent({
        type: 'conversations-changed',
        data: { agentId, sessionKey },
      });

      // 发送待处理的权限弹窗请求（流结束前，确保前端收到）
      for (const perm of pendingPermissions) {
        await stream.writeSSE({
          event: 'permission_required',
          data: JSON.stringify(perm),
        });
      }

      // afterTurn — 记忆提取 + 进化更新（异步，不阻塞响应）
      const afterTurnCtx = {
        ...turnCtx,
        messages: [
          ...messages,
          {
            id: crypto.randomUUID(),
            conversationId: sessionKey,
            role: 'assistant' as const,
            content: cleanResponse,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      contextEngine.afterTurn(afterTurnCtx).catch((err) => {
        log.error('afterTurn 失败:', err);
      });
    });
  });

  /** POST /:agentId/cancel — 取消正在运行或排队中的 Agent 任务 */
  app.post('/:agentId/cancel', async (c) => {
    if (!laneQueue) {
      return c.json({ cancelled: false, reason: 'LaneQueue 未启用' });
    }

    const body = await c.req.json<{ sessionKey?: string }>().catch(() => ({ sessionKey: undefined }));
    const sk = body.sessionKey;
    if (!sk) {
      return c.json({ error: '缺少 sessionKey' }, 400);
    }

    const cancelled = laneQueue.abortRunning(sk);
    return c.json({ cancelled });
  });

  return app;
}
