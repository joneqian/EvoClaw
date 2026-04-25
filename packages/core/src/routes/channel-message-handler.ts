/**
 * 渠道消息处理器 — 从 IM Channel 收到的消息，经 BindingRouter 路由后，
 * 在此处加载 Agent 配置、构建工具集、调用 embedded-runner、回复消息。
 *
 * 与 chat.ts 的 SSE 流式端点不同，此处收集完整响应后通过 channelManager.sendMessage() 发送。
 */

import crypto from 'node:crypto';
import type { ChatMessage, ChatMessageAttachment, QuotedMessage } from '@evoclaw/shared';
import { composeMessageWithQuote } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { AgentManager } from '../agent/agent-manager.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { ChannelManager } from '../channel/channel-manager.js';
import type { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import type { FtsStore } from '../infrastructure/db/fts-store.js';
import type { MemoryExtractor } from '../memory/memory-extractor.js';
import { createEvoClawTools } from '../tools/evoclaw-tools.js';
import type { UserMdRenderer } from '../memory/user-md-renderer.js';
import type { SkillDiscoverer } from '../skill/skill-discoverer.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { AgentRunConfig } from '../agent/types.js';
import { emitServerEvent } from '../infrastructure/event-bus.js';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { runEmbeddedAgent, NO_REPLY_TOKEN } from '../agent/embedded-runner.js';
import { buildGroupPeerRoster } from '../agent/peer-roster.js';
import {
  reconstructDisplayContent,
  shouldDisplayMessage,
  extractTextOnly,
  extractToolCallsForUI,
} from '../agent/kernel/incremental-persister.js';
import type { KernelMessage } from '../agent/kernel/types.js';
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
import { createSecondaryLLMCallFn } from '../agent/llm-client.js';
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
  /**
   * 用户"引用回复"的原始消息（若有）
   *
   * handler 会用 composeMessageWithQuote 把它拼成文本前缀注入 Agent context，
   * DB 里的 user 行也会带上这段前缀，history 自动携带引用上下文。
   */
  quoted?: QuotedMessage;
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
  memoryStore?: MemoryStore;
  ftsStore?: FtsStore;
  knowledgeGraph?: KnowledgeGraphStore;
  /** 用于多账号渠道工具按 agentId 反查正确的 accountId + adapter */
  bindingRouter?: import('../routing/binding-router.js').BindingRouter;
  // M13 team-mode 依赖（可选；缺省则 team mode 工具不注入，旧单 Agent 行为保留）
  taskPlanService?: import('../agent/team-mode/task-plan/service.js').TaskPlanService;
  artifactService?: import('../agent/team-mode/artifacts/service.js').ArtifactService;
  peerRosterService?: import('../agent/team-mode/peer-roster-service.js').PeerRosterService;
  loopGuard?: import('../agent/team-mode/loop-guard.js').LoopGuard;
  userCommandHandler?: import('../agent/team-mode/user-commands.js').UserCommandHandler;
}

/** 通道特定的工具禁止规则 */
const CHANNEL_TOOL_DENY: Record<string, string[]> = {
  voice: ['tts'],
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/**
 * 判断 ChannelMessage 的媒体是否是图片
 *
 * mimeType 缺失或不是 `image/*` 时回退用文件扩展名判断，兼容飞书某些类型
 * 下载下来只有 mime=application/octet-stream 的情况
 */
function isImageMimeType(mimeType: string, filePath: string): boolean {
  if (mimeType.startsWith('image/')) return true;
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

/** 从 conversation_log 加载最近消息历史（UI + LLM 历史共用，过滤纯工具消息） */
function loadMessageHistory(db: SqliteStore, agentId: string, sessionKey: string, limit: number = 20): ChatMessage[] {
  const rawRows = db.all<{
    id: string;
    session_key: string;
    role: string;
    content: string;
    created_at: string;
    kernel_message_json: string | null;
  }>(
    `SELECT id, session_key, role, content, created_at, kernel_message_json
     FROM conversation_log
     WHERE agent_id = ? AND session_key = ? AND role IN ('user', 'assistant')
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
    agentId, sessionKey, limit,
  );

  // 去重：丢弃 saveMessage 写入的冗余 assistant 行（kernel_message_json 为空）
  // 仅当本 session 存在任何 persister 写入的 assistant 行时生效，保护老数据不误删
  const hasPersisterAssistant = rawRows.some(
    r => r.role === 'assistant' && r.kernel_message_json !== null,
  );
  const rows = hasPersisterAssistant
    ? rawRows.filter(r => !(r.role === 'assistant' && r.kernel_message_json === null))
    : rawRows;

  const result: ChatMessage[] = [];
  for (const row of rows.reverse()) {
    // 优先：从 kernel_message_json 精确重建
    if (row.kernel_message_json) {
      try {
        const kmsg = JSON.parse(row.kernel_message_json) as KernelMessage;
        if (!shouldDisplayMessage(kmsg)) continue; // 过滤纯 tool_result / 纯 thinking

        const msg: ChatMessage = {
          id: row.id,
          conversationId: row.session_key,
          role: row.role as ChatMessage['role'],
          content: extractTextOnly(kmsg),
          createdAt: row.created_at,
        };
        const toolCalls = extractToolCallsForUI(kmsg);
        if (toolCalls) (msg as any).toolCalls = toolCalls;
        const attachments = extractImageAttachments(kmsg);
        if (attachments.length > 0) msg.attachments = attachments;
        result.push(msg);
        continue;
      } catch {
        // JSON 损坏 → 降级
      }
    }

    // 降级：原样 + 占位符重建
    result.push({
      id: row.id,
      conversationId: row.session_key,
      role: row.role as ChatMessage['role'],
      content: reconstructDisplayContent(row.content, row.kernel_message_json),
      createdAt: row.created_at,
    });
  }
  return result;
}

/**
 * 从 KernelMessage 里抽出图片类 ContentBlock，转成 ChatMessageAttachment
 *
 * 用途：
 * - 跨轮对话加载历史时，把之前存过的 ImageBlock 恢复为 attachments，让后续
 *   attempt 重新填入 user message 给多模态模型继续可见
 * - 前端 MessageBubble 据此渲染缩略图
 */
function extractImageAttachments(kmsg: KernelMessage): ChatMessageAttachment[] {
  const result: ChatMessageAttachment[] = [];
  for (const block of kmsg.content) {
    if (block.type === 'image') {
      const img = block as { source: { media_type: string; data: string } };
      result.push({
        type: 'image',
        mimeType: img.source.media_type,
        base64: img.source.data,
      });
    }
  }
  return result;
}

/** 工具调用摘要（与前端 ToolCall 一致） */
interface ToolCallRecord {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

/** 生成渠道消息中的工具调用简化提示 */
function formatToolHintForChannel(toolName: string): string {
  const hints: Record<string, string> = {
    web_search: '🔍 正在搜索...',
    web_fetch: '🌐 正在获取网页...',
    read: '📄 正在读取文件...',
    write: '✏️ 正在写入文件...',
    edit: '✏️ 正在编辑文件...',
    bash: '⚙️ 正在执行命令...',
    image: '🖼️ 正在分析图片...',
    pdf: '📑 正在读取 PDF...',
    memory_search: '🧠 正在搜索记忆...',
    spawn_agent: '🤖 正在创建子任务...',
  };
  return hints[toolName] ?? '🔧 正在处理...';
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

/**
 * 构造带图片附件的 user KernelMessage JSON（供 saveMessage 持久化）
 *
 * 纯文本消息返回 null（保持老行为不写 kernel_message_json 列）；
 * 有图片时读文件 → base64 → ImageBlock，拼进 content 数组。
 *
 * 所有 IO 失败（文件不存在 / 过大 / IO 错）一律降级为 null，调用方退回纯文本
 * 存储，不影响主流程。
 */
function buildUserKernelMessageJson(params: {
  content: string;
  mediaPath?: string;
  mediaType?: string;
}): string | null {
  if (!params.mediaPath) return null;
  if (!isImageMimeType(params.mediaType ?? '', params.mediaPath)) return null;

  try {
    const fs = require('node:fs') as typeof import('node:fs');
    if (!fs.existsSync(params.mediaPath)) return null;
    const stat = fs.statSync(params.mediaPath);
    // 与 runner 侧 MAX_INPUT_IMAGE_BYTES 保持一致，防止 DB 写入超大 base64
    if (stat.size > 10 * 1024 * 1024) return null;
    const buffer = fs.readFileSync(params.mediaPath);
    const mimeType = params.mediaType?.startsWith('image/')
      ? params.mediaType
      : inferImageMime(params.mediaPath);
    const content = [
      { type: 'text', text: params.content },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: buffer.toString('base64'),
        },
      },
    ];
    return JSON.stringify({ id: crypto.randomUUID(), role: 'user', content });
  } catch {
    return null;
  }
}

function inferImageMime(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    default: return 'image/png';
  }
}

/**
 * 存储消息到 conversation_log
 *
 * 可选 `kernelMessageJson`：带 ImageBlock 等结构化内容的消息（如多模态输入）
 * 把完整 KernelMessage 序列化写入 kernel_message_json 列，让下一轮
 * loadMessageHistory 能从中还原 attachments，模型仍能看到前几轮的图片。
 */
function saveMessage(
  db: SqliteStore, agentId: string, sessionKey: string,
  role: string, content: string, toolCalls?: ToolCallRecord[],
  kernelMessageJson?: string | null,
): void {
  const toolCallsJson = toolCalls && toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
  db.run(
    `INSERT INTO conversation_log (id, agent_id, session_key, role, content, tool_calls_json, compaction_status, created_at, kernel_message_json)
     VALUES (?, ?, ?, ?, ?, ?, 'raw', ?, ?)`,
    crypto.randomUUID(), agentId, sessionKey, role, content, toolCallsJson, new Date().toISOString(),
    kernelMessageJson ?? null,
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
  const { agentId, sessionKey, channel, peerId, chatType } = ctx;
  // 引用回复：把被引用消息拼成 <quoted_message> 前缀一起喂给 Agent + 存 DB + 进历史
  const message = composeMessageWithQuote(ctx.message, ctx.quoted);
  const { store, agentManager, channelManager, configManager, hybridSearcher, memoryExtractor, userMdRenderer, skillDiscoverer, laneQueue, memoryStore, ftsStore, knowledgeGraph } = deps;

  // 多账号：解析本 Agent 在该 channel 下绑定的 accountId，后续 sendMessage 显式传入，
  // 避免 ChannelManager 在无 accountId 时回退到"第一个 adapter"导致所有 Agent 的回复
  // 都从同一个 bot app 发出去（多 bot 群场景下 avatar 会统一串到首个应用头像上）。
  // 老单账号数据 accountId 可能为 null/undefined，这里退到 ''，ChannelManager 的
  // fallback 会选到唯一的 adapter，行为与旧实现一致。
  const agentBindings = deps.bindingRouter?.listBindings(agentId) ?? [];
  const matchedBinding = agentBindings.find((b) => b.channel === channel);
  const channelAccountId = matchedBinding?.accountId ?? '';

  // 多 bot 群的典型数据老化坑：PR #63 之前建的 binding 没回填 account_id，
  // 沉默走 ChannelManager fallback = 永远挑 slot 第一个 adapter = 本 Agent 的回复从
  // "群里第一个 bot" 的头像发出去，看起来像"一个头像说了多个人格的话"。
  // 打 WARN 让用户及时发现并手动解绑-重绑修复。
  if (matchedBinding && !channelAccountId) {
    log.warn(
      `Agent ${agentId} 在 channel=${channel} 的 binding 缺 accountId（老数据），` +
      `本条回复将走默认 adapter，多 bot 场景下头像可能错位。` +
      `请到桌面端"专家设置 → ${channel} → 解绑 → 重新连接"修复此 binding。`,
    );
  }

  // 1. 获取 Agent 配置
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    log.warn(`Agent 不存在: ${agentId}`);
    return '';
  }

  // 更新最近对话时间
  agentManager.touchLastChat(agentId);

  // M13 team-mode：群聊里识别用户触发词 /pause /cancel /revise，命中则短路（不进 LLM）
  if (chatType === 'group' && deps.userCommandHandler) {
    try {
      const groupSessionKey = `${channel}:chat:${peerId}` as const;
      const cmdResult = await deps.userCommandHandler.handle(message, groupSessionKey, undefined);
      if (cmdResult && cmdResult.shortCircuit) {
        log.info(
          `[team-mode] 用户命令短路 agent=${agentId} group=${peerId} affected_plans=${cmdResult.affectedPlans}`,
        );
        return cmdResult.replyText;
      }
    } catch (err) {
      log.warn(
        `[team-mode] 用户命令处理失败 agent=${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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
    warnings: [] as string[],
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

  // BOOTSTRAP.md 生命周期检测
  const bootstrapSeeded = agentManager.getWorkspaceState(agentId, 'bootstrap_seeded_at');
  const setupCompleted = agentManager.getWorkspaceState(agentId, 'setup_completed_at');

  if (bootstrapSeeded && !setupCompleted) {
    const bootstrapContent = agentManager.readWorkspaceFile(agentId, 'BOOTSTRAP.md');
    const bootstrapDone = !bootstrapContent || bootstrapContent.trim().length === 0 || history.length >= 12;
    if (bootstrapDone) {
      agentManager.setWorkspaceState(agentId, 'setup_completed_at', new Date().toISOString());
      agentManager.writeWorkspaceFile(agentId, 'BOOTSTRAP.md', '');
    }
  }

  // setup 已完成 → 不再注入 BOOTSTRAP.md（出生只有一次）
  if (setupCompleted || agentManager.getWorkspaceState(agentId, 'setup_completed_at')) {
    delete workspaceFiles['BOOTSTRAP.md'];
  }

  // 6. 构建增强工具集
  const braveApiKey = configManager?.getBraveApiKey() ?? '';
  const providerConfig = { apiKey, provider, modelId, baseUrl, apiProtocol };
  const enhancedTools: ToolDefinition[] = [];

  if (braveApiKey) enhancedTools.push(createWebSearchTool({ braveApiKey }));
  const secondaryLLMCall = configManager ? createSecondaryLLMCallFn(configManager) : undefined;
  // M8: 域名黑名单 — 通过 getter 支持热重载
  const getDomainDenylist = () => configManager?.getConfig().security?.domainDenylist;
  enhancedTools.push(createWebFetchTool({ llmCall: secondaryLLMCall, domainDenylist: getDomainDenylist }));

  // 记忆和知识图谱工具（与 chat.ts 路径一致）
  if (hybridSearcher && memoryStore && ftsStore && knowledgeGraph) {
    enhancedTools.push(...createEvoClawTools({
      searcher: hybridSearcher,
      memoryStore,
      knowledgeGraph,
      ftsStore,
      agentId,
      skipWebTools: true,
      enableSkillManage: true,
    }));
  }

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

  // 注入渠道专属工具 — peerId / sessionKey / agentId 自动绑定，Agent 无需填写
  // agentId 供多账号工具按 binding 反查正确 accountId（比如同一飞书工具给不同
  // Agent 调用时路由到各自绑定的应用）
  const channelTools = createChannelTools(channelManager, channel as ChannelType, deps.bindingRouter);
  for (const ct of channelTools) {
    if (ct.name === 'desktop_notify') continue; // 渠道模式不需要桌面通知
    enhancedTools.push({
      name: ct.name,
      description: ct.description,
      // JSON Schema 结构化类型与下游 Record 宽类型等价，需 unknown 中转 cast
      parameters: ct.parameters as unknown as Record<string, unknown>,
      // 自动注入 peerId + sessionKey + agentId（防 agent 伪造跨会话 / 跨账号）
      execute: async (args) => ct.execute({ ...args, peerId, sessionKey, agentId }),
    });
  }

  // M13 team-mode 工具：仅当群聊且服务齐全时注入
  // - mention_peer (跨渠道 @ 同事，集成 loop-guard)
  // - create_task_plan / update_task_status / list_tasks / request_clarification
  // - attach_artifact / list_task_artifacts / fetch_artifact
  if (chatType === 'group' && deps.taskPlanService && deps.peerRosterService && deps.loopGuard && deps.bindingRouter && deps.artifactService) {
    try {
      const [{ createTaskPlanTools }, { createMentionPeerTool }, { createArtifactTools }, { teamChannelRegistry }] = await Promise.all([
        import('../agent/team-mode/task-plan/tools.js'),
        import('../agent/team-mode/mention-peer-tool.js'),
        import('../agent/team-mode/artifacts/tools.js'),
        import('../agent/team-mode/team-channel-registry.js'),
      ]);
      const teamTools: ToolDefinition[] = [
        ...createTaskPlanTools(deps.taskPlanService),
        createMentionPeerTool({
          rosterService: deps.peerRosterService,
          registry: teamChannelRegistry,
          loopGuard: deps.loopGuard,
          channelManager,
          bindingRouter: deps.bindingRouter,
        }),
        ...createArtifactTools(deps.artifactService),
      ];
      // 自动注入 sessionKey + agentId（防 agent 伪造）
      for (const tt of teamTools) {
        enhancedTools.push({
          name: tt.name,
          description: tt.description,
          parameters: tt.parameters,
          execute: async (args, ctx2) => tt.execute({ ...args, agentId, sessionKey }, ctx2),
        });
      }
      log.debug(`[team-mode] 注入 ${teamTools.length} 个工具 agent=${agentId} group=${peerId}`);
    } catch (err) {
      log.warn(
        `[team-mode] 工具注入失败 agent=${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    const result = interceptor.intercept(agentId, toolName, args, sessionKey);
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

  // 群聊 peer roster:让 Agent 知道自己身处多 bot 群聊,其他同事是谁,
  // 不归自己的问题就让位。单聊跳过;同 channel 没有其他 active agent 时返回
  // null 也跳过。走 promptOverrides level='agent' append 路径,追加到 system
  // prompt 末尾,不覆盖默认提示。
  const groupPeerRoster =
    chatType === 'group'
      ? buildGroupPeerRoster(agentId, channel, deps.bindingRouter, agentManager)
      : null;

  // M13 team-mode：当群聊 + team-mode 服务齐全 + roster 非空时，叠一段 <team_mode>
  // XML（含同事 mention_id / 我的待办 / 行为规则）。前面 buildGroupPeerRoster 仍保留
  // 作为旧版 fallback，两段都会 append 到 system prompt 末尾。
  let teamModeFragment: string | null = null;
  if (chatType === 'group' && deps.peerRosterService && deps.taskPlanService) {
    try {
      const groupSessionKey = `${channel}:chat:${peerId}` as const;
      const peerRoster = await deps.peerRosterService.buildRoster(agentId, groupSessionKey);
      if (peerRoster.length > 0) {
        const myOpenTasks = deps.taskPlanService.listOpenTasksForAssignee(agentId, groupSessionKey);
        const { renderTeamModePrompt } = await import('../agent/team-mode/prompt-fragment.js');
        teamModeFragment = renderTeamModePrompt({
          channelType: channel,
          groupSessionKey,
          roster: peerRoster,
          myOpenTasks: myOpenTasks.map((t) => ({
            localId: t.localId,
            title: t.title,
            status: t.status,
            dependsOn: t.dependsOn,
          })),
        });
      }
    } catch (err) {
      log.warn(
        `team-mode prompt 注入失败 agent=${agentId} group=${peerId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

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
    ...(() => {
      const overrides: Array<{ level: 'agent'; mode: 'append'; content: string }> = [];
      if (groupPeerRoster) {
        overrides.push({ level: 'agent', mode: 'append', content: groupPeerRoster });
      }
      if (teamModeFragment) {
        overrides.push({ level: 'agent', mode: 'append', content: teamModeFragment });
      }
      return overrides.length > 0 ? { promptOverrides: overrides } : {};
    })(),
    // 多模态附件：IM 渠道（飞书/微信）下载到本地的图片通过 inputAttachments
    // 原生注入 user message，embedded-runner 会转成 ImageBlock 喂给模型，
    // 省去 Agent 再调 image 工具的弯路
    ...(ctx.mediaPath && isImageMimeType(ctx.mediaType ?? '', ctx.mediaPath)
      ? {
          inputAttachments: [
            {
              type: 'image' as const,
              path: ctx.mediaPath,
              ...(ctx.mediaType ? { mimeType: ctx.mediaType } : {}),
            },
          ],
        }
      : {}),
    // store + sessionKey：embedded-runner-attempt 需要这两个字段才会构造
    // IncrementalPersister 把 assistant 消息写入 conversation_log。
    // 缺失时 agent 能正常跑完 + fullResponse 累加给渠道发出，但 DB 里
    // 永远只有 user 消息，桌面前端打开该会话看不到回复。
    store,
    sessionKey,
  };

  // 7. 存储用户消息
  //
  // 多模态情况：有 inputAttachments（图片）时，把图片读成 base64 一起写 kernel_message_json，
  // 让下一轮 loadMessageHistory 能还原 ImageBlock，模型仍能看到历史图片。
  // 纯文本消息保持老行为（只写 content 列，kernel_message_json 留空）。
  const userKernelMessageJson = buildUserKernelMessageJson({
    content: message,
    mediaPath: ctx.mediaPath,
    mediaType: ctx.mediaType,
  });
  saveMessage(store, agentId, sessionKey, 'user', message, undefined, userKernelMessageJson);

  // 8. 运行 Agent（收集 text_delta + 工具调用事件）
  let fullResponse = '';
  let thinkingHintSent = false;
  const collectedToolCalls: ToolCallRecord[] = [];

  const runAgent = async (abortSignal?: AbortSignal) => {
    await runEmbeddedAgent(runConfig, message, (event) => {
      if (event.type === 'text_delta' && event.delta) {
        fullResponse += event.delta;
      }
      // 收集工具调用信息（与前端 streaming 逻辑对齐）
      if (event.type === 'tool_start') {
        const toolName = (event as any).toolName ?? '未知工具';
        const args = (event as any).toolArgs;
        collectedToolCalls.push({ name: toolName, status: 'running', summary: formatToolSummary(toolName, args) });
        // 首次工具调用时，发送简化摘要提示
        if (!thinkingHintSent) {
          thinkingHintSent = true;
          const toolHint = formatToolHintForChannel(toolName);
          channelManager.sendMessage(channel as any, channelAccountId, peerId, toolHint, chatType === 'group' ? 'group' : 'private')
            .catch((err) => { log.warn(`工具提示发送失败: ${err instanceof Error ? err.message : String(err)}`); });
        }
      }
      if (event.type === 'tool_end') {
        const endName = (event as any).toolName;
        const tc = collectedToolCalls.find(t => t.name === endName && t.status === 'running');
        if (tc) tc.status = (event as any).isError ? 'error' : 'done';
      }
    }, abortSignal);
  };

  if (laneQueue) {
    const runId = `channel-${crypto.randomUUID()}`;
    const abortController = new AbortController();
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

  // 批量写入审计日志
  auditQueue.flush();

  // 9. 清理 assistant 响应文本（剥离 PI 框架内部的工具调用/响应 XML 标记，供渠道发送使用）
  // 注：Assistant 消息已由 IncrementalPersister 在 query-loop 每轮结束后持久化到 conversation_log
  //    此处不再重复 saveMessage，避免前端历史展示重复和顺序混乱。
  const cleanResponse = fullResponse
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<function_response>[\s\S]*?<\/function_response>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 诊断：明确报告响应状态，便于排查"Agent 回了但渠道没发"问题
  log.info(
    `渠道回复准备发送 channel=${channel} peer=${peerId} ` +
      `fullResponse=${fullResponse.length}字符 clean=${cleanResponse.length}字符 ` +
      `isNoReply=${cleanResponse === NO_REPLY_TOKEN}`,
  );

  // 10. 通过 Channel 发送回复（跳过 NO_REPLY 和空响应）
  if (cleanResponse && cleanResponse !== NO_REPLY_TOKEN) {
    try {
      log.info(`开始发送渠道回复: channel=${channel} accountId=${channelAccountId || '(default)'} peer=${peerId} chars=${cleanResponse.length}`);
      await channelManager.sendMessage(
        channel as any,
        channelAccountId,
        peerId,
        cleanResponse,
        chatType === 'group' ? 'group' : 'private',
      );
      log.info(`渠道回复发送成功: channel=${channel} accountId=${channelAccountId || '(default)'} peer=${peerId}`);
    } catch (sendErr) {
      log.error(`渠道回复发送失败 (channel=${channel} peer=${peerId}):`, sendErr);
    }
  } else {
    log.warn(
      `渠道回复被跳过 (cleanResponse 空或 NO_REPLY): channel=${channel} peer=${peerId} ` +
        `原始长度=${fullResponse.length}`,
    );
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
