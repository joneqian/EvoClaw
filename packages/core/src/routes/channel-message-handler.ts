/**
 * 渠道消息处理器 — 从 IM Channel 收到的消息，经 BindingRouter 路由后，
 * 在此处加载 Agent 配置、构建工具集、调用 embedded-runner、回复消息。
 *
 * 与 chat.ts 的 SSE 流式端点不同，此处收集完整响应后通过 channelManager.sendMessage() 发送。
 */

import crypto from 'node:crypto';
import type { ChatMessage } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { AgentManager } from '../agent/agent-manager.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { ChannelManager } from '../channel/channel-manager.js';
import type { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryExtractor } from '../memory/memory-extractor.js';
import type { UserMdRenderer } from '../memory/user-md-renderer.js';
import type { SkillDiscoverer } from '../skill/skill-discoverer.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { AgentRunConfig } from '../agent/types.js';
import { emitServerEvent } from '../infrastructure/event-bus.js';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { runEmbeddedAgent, NO_REPLY_TOKEN } from '../agent/embedded-runner.js';
import { resolveModel } from '../provider/model-resolver.js';
import { ContextEngine } from '../context/context-engine.js';
import { contextAssemblerPlugin } from '../context/plugins/context-assembler.js';
import { sessionRouterPlugin } from '../context/plugins/session-router.js';
import { createSecurityPlugin } from '../context/plugins/security.js';
import { createPermissionPlugin } from '../context/plugins/permission.js';
import { createMemoryRecallPlugin } from '../context/plugins/memory-recall.js';
import { createMemoryExtractPlugin } from '../context/plugins/memory-extract.js';
import { createToolRegistryPlugin } from '../context/plugins/tool-registry.js';
import { createGapDetectionPlugin } from '../context/plugins/gap-detection.js';
import { SecurityExtension } from '../bridge/security-extension.js';
import { PermissionInterceptor } from '../tools/permission-interceptor.js';
import { setToolInjectorConfig, getInjectedTools, ToolAuditQueue } from '../bridge/tool-injector.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createImageTool } from '../tools/image-tool.js';
import { createPdfTool } from '../tools/pdf-tool.js';
import { createBrowserTool } from '../tools/browser-tool.js';
import { createImageGenerateTool } from '../tools/image-generate-tool.js';
import { createExecBackgroundTool, createProcessTool } from '../tools/background-process.js';
import { createChannelTools } from '../tools/channel-tools.js';
import type { ChannelType } from '@evoclaw/shared';
import { parseSessionKey } from '../routing/session-key.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('channel-msg-handler');

/** 渠道消息上下文 */
export interface ChannelMessageContext {
  agentId: string;
  sessionKey: string;
  message: string;
  channel: string;
  peerId: string;
  chatType: 'private' | 'group';
  mediaPath?: string;
  mediaType?: string;
}

/** 处理器依赖 */
export interface ChannelMessageDeps {
  store: SqliteStore;
  agentManager: AgentManager;
  channelManager: ChannelManager;
  configManager?: ConfigManager;
  vectorStore?: VectorStore;
  hybridSearcher?: HybridSearcher;
  memoryExtractor?: MemoryExtractor;
  userMdRenderer?: UserMdRenderer;
  skillDiscoverer?: SkillDiscoverer;
  laneQueue?: LaneQueue;
}

/** 通道特定的工具禁止规则 */
const CHANNEL_TOOL_DENY: Record<string, string[]> = {
  voice: ['tts'],
};

/** 从 conversation_log 加载最近消息历史 */
function loadMessageHistory(db: SqliteStore, agentId: string, sessionKey: string, limit: number = 20): ChatMessage[] {
  const rows = db.all<{
    id: string;
    session_key: string;
    role: string;
    content: string;
    created_at: string;
  }>(
    `SELECT id, session_key, role, content, created_at
     FROM conversation_log
     WHERE agent_id = ? AND session_key = ? AND role IN ('user', 'assistant')
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
    agentId, sessionKey, limit,
  );

  return rows.reverse().map(row => ({
    id: row.id,
    conversationId: row.session_key,
    role: row.role as ChatMessage['role'],
    content: row.content,
    createdAt: row.created_at,
  }));
}

/** 工具调用摘要（与前端 ToolCall 一致） */
interface ToolCallRecord {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

/** 生成工具调用摘要（与前端 formatToolSummary 对齐） */
function formatToolSummary(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  switch (name) {
    case 'bash': return a.command ? `$ ${String(a.command).slice(0, 80)}` : '';
    case 'read': return a.file_path ? String(a.file_path) : (a.path ? String(a.path) : '');
    case 'write':
    case 'edit': return a.file_path ? String(a.file_path) : '';
    case 'find': return a.pattern ? `${a.pattern}` : '';
    case 'grep': return a.pattern ? `/${a.pattern}/` : '';
    case 'web_search': return a.query ? `"${String(a.query).slice(0, 60)}"` : '';
    case 'web_fetch': return a.url ? String(a.url).slice(0, 80) : '';
    case 'image': return a.path ? String(a.path).split('/').pop() ?? '' : '';
    case 'pdf': return a.path ? String(a.path).split('/').pop() ?? '' : '';
    default: return '';
  }
}

/** 存储消息到 conversation_log */
function saveMessage(
  db: SqliteStore, agentId: string, sessionKey: string,
  role: string, content: string, toolCalls?: ToolCallRecord[],
): void {
  const toolCallsJson = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
  db.run(
    `INSERT INTO conversation_log (id, agent_id, session_key, role, content, tool_calls_json, compaction_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'raw', ?)`,
    crypto.randomUUID(), agentId, sessionKey, role, content, toolCallsJson, new Date().toISOString(),
  );
}

/**
 * 处理渠道消息 — 加载 Agent 配置、构建工具集、运行 Agent、回复消息
 * 返回 Agent 的完整响应文本（空字符串表示无响应）
 */
export async function handleChannelMessage(
  ctx: ChannelMessageContext,
  deps: ChannelMessageDeps,
): Promise<string> {
  const { agentId, sessionKey, message, channel, peerId, chatType } = ctx;
  const { store, agentManager, channelManager, configManager, hybridSearcher, memoryExtractor, userMdRenderer, skillDiscoverer, laneQueue } = deps;

  // 1. 获取 Agent 配置
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    log.warn(`Agent 不存在: ${agentId}`);
    return '';
  }

  // 更新最近对话时间
  agentManager.touchLastChat(agentId);

  // 2. 解析模型 + API 配置
  let modelId = '';
  let provider = '';
  let apiKey = '';
  let baseUrl = '';
  let apiProtocol = 'openai-completions';

  if (agent.modelId && agent.provider && configManager) {
    modelId = agent.modelId;
    provider = agent.provider;
    const providerEntry = configManager.getProvider(provider);
    if (providerEntry) {
      apiKey = providerEntry.apiKey;
      baseUrl = providerEntry.baseUrl;
      apiProtocol = providerEntry.api;
    }
  }

  if (!apiKey && configManager) {
    provider = configManager.getDefaultProvider();
    modelId = configManager.getDefaultModelId();
    apiKey = configManager.getDefaultApiKey();
    baseUrl = configManager.getDefaultBaseUrl();
    apiProtocol = configManager.getDefaultApi();
  }

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
    log.error(`渠道消息处理失败: Agent ${agentId} 未配置 API Key`);
    return '';
  }

  // 3. 创建 ContextEngine 并注册插件
  const contextEngine = new ContextEngine();
  contextEngine.register(createSecurityPlugin(store));
  contextEngine.register(sessionRouterPlugin);
  contextEngine.register(contextAssemblerPlugin);

  const security = new SecurityExtension(store);
  contextEngine.register(createPermissionPlugin(security));

  if (hybridSearcher) {
    contextEngine.register(createMemoryRecallPlugin(hybridSearcher));
  }
  if (memoryExtractor) {
    contextEngine.register(createMemoryExtractPlugin(memoryExtractor));
  }

  contextEngine.register(createToolRegistryPlugin({
    getDisabledSkills: (aId) => {
      const rows = store.all<{ skill_name: string }>(
        'SELECT skill_name FROM agent_skills WHERE agent_id = ? AND enabled = 0',
        aId,
      );
      return new Set(rows.map(r => r.skill_name));
    },
  }));
  contextEngine.register(createGapDetectionPlugin(skillDiscoverer));

  // 4. 加载消息历史
  const history = loadMessageHistory(store, agentId, sessionKey);

  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    conversationId: sessionKey,
    role: 'user',
    content: message,
    createdAt: new Date().toISOString(),
  };
  const messages = [...history, userMsg];

  // 5. 工作区文件
  const workspacePath = agentManager.getWorkspacePath?.(agentId) ?? '';

  await contextEngine.bootstrap({
    agentId,
    sessionKey: sessionKey as any,
    workspacePath,
  });

  // 渲染 USER.md / MEMORY.md
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

  // beforeTurn
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

  const systemPrompt = turnCtx.injectedContext.join('\n\n---\n\n');

  // 按 session 类型选择工作区文件
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

  // 6. 构建增强工具集
  const braveApiKey = configManager?.getBraveApiKey() ?? '';
  const providerConfig = { apiKey, provider, modelId, baseUrl, apiProtocol };
  const enhancedTools: ToolDefinition[] = [];

  if (braveApiKey) enhancedTools.push(createWebSearchTool({ braveApiKey }));
  enhancedTools.push(createWebFetchTool());
  enhancedTools.push(createImageTool(providerConfig));
  enhancedTools.push(createPdfTool(providerConfig));
  enhancedTools.push(createBrowserTool());

  if (apiKey) {
    enhancedTools.push(createImageGenerateTool({
      apiKey,
      baseUrl: baseUrl || undefined,
      provider,
    }));
  }

  enhancedTools.push(createExecBackgroundTool());
  enhancedTools.push(createProcessTool());

  // 注入渠道专属工具 — peerId 自动绑定当前对话用户，Agent 无需填写
  const channelTools = createChannelTools(channelManager, channel as ChannelType);
  for (const ct of channelTools) {
    if (ct.name === 'desktop_notify') continue; // 渠道模式不需要桌面通知
    const isMedia = ct.name.endsWith('_send_media');
    enhancedTools.push({
      name: ct.name,
      description: isMedia
        ? '发送文件给用户（图片/视频/文档），需提供本地文件路径'
        : '发送文本消息给用户',
      parameters: isMedia
        ? { type: 'object', properties: { filePath: { type: 'string', description: '本地文件绝对路径' }, text: { type: 'string', description: '附带说明文字（可选）' } }, required: ['filePath'] }
        : { type: 'object', properties: { content: { type: 'string', description: '消息内容' } }, required: ['content'] },
      execute: async (args) => ct.execute({ ...args, peerId }),  // 自动注入 peerId
    });
  }

  // 通道特定工具禁止
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

  // 权限拦截器（渠道消息默认拒绝需要确认的操作）
  const interceptor = new PermissionInterceptor(
    security,
    (aId) => agentManager.getWorkspacePath(aId),
  );

  const permissionInterceptFn = async (toolName: string, args: Record<string, unknown>): Promise<string | null> => {
    const result = interceptor.intercept(agentId, toolName, args);
    if (!result.allowed) {
      // 渠道模式没有 UI 弹框，区分处理：
      // - 需要确认的（requiresConfirmation）→ 自动放行（用户已绑定 Agent，隐式信任）
      // - 硬性拒绝的（危险命令/受限路径）→ 仍然阻止
      if (result.requiresConfirmation) {
        log.debug(`渠道模式自动放行: tool=${toolName} category=${result.permissionCategory ?? 'unknown'}`);
        return null;
      }
      return result.reason ?? '操作被拒绝';
    }
    return null;
  };

  // 审计日志异步队列
  const auditQueue = new ToolAuditQueue(store);
  const auditLogFn = (entry: { toolName: string; args: Record<string, unknown>; result: string; status: 'success' | 'error' | 'denied'; durationMs: number }) => {
    auditQueue.push({
      agentId,
      sessionKey,
      toolName: entry.toolName,
      inputJson: JSON.stringify(entry.args),
      outputJson: entry.result.slice(0, 5000),
      status: entry.status,
      durationMs: entry.durationMs,
    });
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
    permissionInterceptFn,
    auditLogFn,
  };

  // 7. 存储用户消息
  saveMessage(store, agentId, sessionKey, 'user', message);

  // 8. 运行 Agent（收集 text_delta + 工具调用事件）
  let fullResponse = '';
  let thinkingHintSent = false;
  const collectedToolCalls: ToolCallRecord[] = [];

  await runEmbeddedAgent(runConfig, message, (event) => {
    if (event.type === 'text_delta' && event.delta) {
      fullResponse += event.delta;
    }
    // 收集工具调用信息（与前端 streaming 逻辑对齐）
    if (event.type === 'tool_start') {
      const toolName = (event as any).toolName ?? '未知工具';
      const args = (event as any).toolArgs;
      collectedToolCalls.push({ name: toolName, status: 'running', summary: formatToolSummary(toolName, args) });
      // 首次工具调用时，发送"思考中"提示
      if (!thinkingHintSent) {
        thinkingHintSent = true;
        channelManager.sendMessage(channel as any, peerId, '让我看看，稍等一下~', chatType === 'group' ? 'group' : 'private')
          .catch((err) => { log.warn(`思考提示发送失败: ${err instanceof Error ? err.message : String(err)}`); });
      }
    }
    if (event.type === 'tool_end') {
      const endName = (event as any).toolName;
      const tc = collectedToolCalls.find(t => t.name === endName && t.status === 'running');
      if (tc) tc.status = (event as any).isError ? 'error' : 'done';
    }
  });

  // 批量写入审计日志
  auditQueue.flush();

  // 9. 存储 assistant 响应（剥离 PI 框架内部的工具调用/响应 XML 标记）
  const cleanResponse = fullResponse
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<function_response>[\s\S]*?<\/function_response>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleanResponse) {
    saveMessage(store, agentId, sessionKey, 'assistant', cleanResponse, collectedToolCalls);
  }

  // 10. 通过 Channel 发送回复（跳过 NO_REPLY 和空响应）
  if (cleanResponse && cleanResponse !== NO_REPLY_TOKEN) {
    try {
      await channelManager.sendMessage(
        channel as any,
        peerId,
        cleanResponse,
        chatType === 'group' ? 'group' : 'private',
      );
    } catch (sendErr) {
      log.error(`渠道回复发送失败 (channel=${channel} peer=${peerId}):`, sendErr);
    }
  }

  // 11. 通知前端有新会话/消息（携带新消息数据，前端无需二次请求）
  emitServerEvent({
    type: 'conversations-changed',
    data: {
      agentId, channel, peerId, sessionKey,
      newMessage: cleanResponse ? {
        role: 'assistant',
        content: cleanResponse.slice(0, 2000),
        toolCalls: collectedToolCalls,
        createdAt: new Date().toISOString(),
      } : undefined,
    },
  });

  // 12. afterTurn — 记忆提取（异步，不阻塞）
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

  return cleanResponse;
}
