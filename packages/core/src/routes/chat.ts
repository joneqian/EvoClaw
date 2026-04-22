import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import crypto from 'node:crypto';
import { isBun } from '../infrastructure/runtime.js';
import { createBunSSEResponse } from '../infrastructure/bun-sse.js';

/**
 * Bun SSE 绕行映射 — 存储原始 SSE Response，供 Bun.serve 层直接返回
 *
 * Hono 中间件（CORS 等）会 clone/wrap Response，破坏 Bun 的流式传输。
 * 路由层将原始 Bun Response 存入此 WeakMap，Bun.serve 的 fetch 在
 * app.fetch 返回后检查此映射：若存在则替换 Hono 的包装版本。
 */
export const bunSSEResponses = new WeakMap<Request, Response>();
import { AgentManager } from '../agent/agent-manager.js';
import { runEmbeddedAgent } from '../agent/embedded-runner.js';
import type { AgentRunConfig } from '../agent/types.js';
import { lookupModelDefinition } from '../provider/extensions/index.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ChatMessage } from '@evoclaw/shared';
import { parseQuotedPrefix } from '@evoclaw/shared';
import { ContextEngine } from '../context/context-engine.js';
import type { TurnContext } from '../context/plugin.interface.js';
import { contextAssemblerPlugin } from '../context/plugins/context-assembler.js';
import { sessionRouterPlugin } from '../context/plugins/session-router.js';
import { resolveModel } from '../provider/model-resolver.js';
import { generateSessionKey } from '../routing/session-key.js';
import { setToolInjectorConfig, getInjectedTools, ToolAuditQueue } from '../bridge/tool-injector.js';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { createSecondaryLLMCallFn } from '../agent/llm-client.js';
import {
  evaluateRisk as smartEvaluateRisk,
  shouldEvaluate as smartShouldEvaluate,
  SmartDecisionCache,
} from '../security/smart-approve.js';
import { createImageTool } from '../tools/image-tool.js';
import { createPdfTool } from '../tools/pdf-tool.js';
import { createApplyPatchTool } from '../tools/apply-patch.js';
import { createSubAgentTools } from '../tools/sub-agent-tools.js';
import { createBrowserTool } from '../tools/browser-tool.js';
import { createImageGenerateTool } from '../tools/image-generate-tool.js';
import { filterToolsByProfile, type ToolProfileId } from '../agent/tool-catalog.js';
import { createExecBackgroundTool, createProcessTool } from '../tools/background-process.js';
import { createTodoWriteTool } from '../tools/todo-tool.js';
import { createScheduleTool } from '../tools/schedule-tool.js';
import { SubAgentSpawner } from '../agent/sub-agent-spawner.js';
import { PermissionBubbleManager } from '../agent/permission-bubble.js';
import type { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import type { FtsStore } from '../infrastructure/db/fts-store.js';
import type { MemoryExtractor } from '../memory/memory-extractor.js';
import { createEvoClawTools } from '../tools/evoclaw-tools.js';
import { createMemoryRecallPlugin } from '../context/plugins/memory-recall.js';
import { createMemoryExtractPlugin } from '../context/plugins/memory-extract.js';
import { createToolRegistryPlugin } from '../context/plugins/tool-registry.js';
import { createGapDetectionPlugin } from '../context/plugins/gap-detection.js';
import { SecurityExtension } from '../bridge/security-extension.js';
import { createPermissionPlugin } from '../context/plugins/permission.js';
import { createSecurityPlugin } from '../context/plugins/security.js';
import { PermissionInterceptor } from '../tools/permission-interceptor.js';
import { DenialTracker } from '../security/denial-tracker.js';
import type { LaneQueue } from '../agent/lane-queue.js';
import type { UserMdRenderer } from '../memory/user-md-renderer.js';
import type { SkillDiscoverer } from '../skill/skill-discoverer.js';
import { parseSessionKey } from '../routing/session-key.js';
import { createLogger } from '../infrastructure/logger.js';
import { emitServerEvent } from '../infrastructure/event-bus.js';
import { drainFormattedSystemEvents } from '../infrastructure/system-events.js';
import { enqueueTaskNotification } from '../infrastructure/task-notifications.js';
import { detectHeartbeatAck } from '../scheduler/heartbeat-utils.js';
import {
  IncrementalPersister,
  reconstructDisplayContent,
  shouldDisplayMessage,
  extractTextOnly,
  extractToolCallsForUI,
} from '../agent/kernel/incremental-persister.js';
import type { KernelMessage } from '../agent/kernel/types.js';
import { bridgeMcpToolsForAgent } from '../mcp/mcp-tool-bridge.js';
import { bridgeAllMcpPrompts } from '../mcp/mcp-prompt-bridge.js';

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

/**
 * 智能会话恢复 — 三级恢复策略
 *
 * Level 1: 查找最近 compaction_boundary → 加载 boundary 之后的消息
 * Level 2: 查找 session_summary → 注入 [摘要] + 最近消息
 * Level 3: 回退到 last-N 原始消息
 *
 * 参考 Claude Code: loadTranscriptFile + buildConversationChain
 */

/** 数据库行类型（loadMessageHistory 查询结果） */
interface ConversationRow {
  id: string; session_key: string; role: string; content: string;
  tool_calls_json: string | null; created_at: string;
  kernel_message_json: string | null;
}

/**
 * 去重：丢弃 saveMessage 写入的冗余 assistant 行
 *
 * 背景：之前 chat.ts 在 agent 完成后既调用 IncrementalPersister（存带
 * kernel_message_json 的完整消息），又调用 saveMessage 存一条 cleanResponse
 * （kernel_message_json 为 NULL），导致 assistant 消息被存 2 次。
 *
 * 策略：
 * - 若 rows 中存在任何 role='assistant' 且 kernel_message_json 非空的行
 *   → 说明本 session 使用了 persister，丢弃所有 assistant + 空 kernel_message_json 的冗余行
 * - 否则（老 session 全部是 saveMessage 写的）→ 原样保留，不误删合法老数据
 */
function dedupeAssistantRows(rows: ConversationRow[]): ConversationRow[] {
  const hasPersisterAssistant = rows.some(
    r => r.role === 'assistant' && r.kernel_message_json !== null,
  );
  if (!hasPersisterAssistant) return rows;
  return rows.filter(
    r => !(r.role === 'assistant' && r.kernel_message_json === null),
  );
}

function loadMessageHistory(db: SqliteStore, agentId: string, sessionKey: string, limit: number = 20): ChatMessage[] {
  // ── Level 0: 恢复崩溃残留的 streaming 消息 ──
  // 将 streaming → orphaned → final，确保不丢失数据
  const orphaned = IncrementalPersister.loadOrphaned(db, agentId, sessionKey);
  if (orphaned.length > 0) {
    log.info(`恢复 ${orphaned.length} 条 orphaned 消息 (session=${sessionKey})`);
  }

  // ── Level 1: 查找最近的 compaction_boundary ──
  const boundary = db.get<{ id: string; created_at: string; content: string }>(
    `SELECT id, created_at, content FROM conversation_log
     WHERE agent_id = ? AND session_key = ? AND entry_type = 'compaction_boundary'
     ORDER BY created_at DESC LIMIT 1`,
    agentId, sessionKey,
  );

  if (boundary) {
    // 加载 boundary 之后的消息
    const postBoundaryRows = db.all<{
      id: string; session_key: string; role: string; content: string;
      tool_calls_json: string | null; created_at: string;
      kernel_message_json: string | null;
    }>(
      `SELECT id, session_key, role, content, tool_calls_json, created_at, kernel_message_json
       FROM conversation_log
       WHERE agent_id = ? AND session_key = ? AND role IN ('user', 'assistant')
         AND created_at > ?
       ORDER BY created_at ASC, rowid ASC`,
      agentId, sessionKey, boundary.created_at,
    );

    const recentMessages = dedupeAssistantRows(postBoundaryRows)
      .map(rowToChatMessage)
      .filter((m): m is ChatMessage => m !== null);

    // 尝试加载摘要注入到 boundary 消息前面
    const summary = db.get<{ summary_markdown: string }>(
      `SELECT summary_markdown FROM session_summaries WHERE agent_id = ? AND session_key = ?`,
      agentId, sessionKey,
    );

    if (summary?.summary_markdown) {
      const summaryMsg: ChatMessage = {
        id: `summary-${boundary.id}`,
        conversationId: sessionKey,
        role: 'user',
        content: `[会话摘要 — 由系统在上下文压缩时生成]\n\n${summary.summary_markdown}`,
        isSummary: true,
        createdAt: boundary.created_at,
      };
      return [summaryMsg, ...recentMessages];
    }

    return recentMessages;
  }

  // ── Level 2: 无 boundary，但有 session_summary ──
  const summary = db.get<{ summary_markdown: string }>(
    `SELECT summary_markdown FROM session_summaries WHERE agent_id = ? AND session_key = ?`,
    agentId, sessionKey,
  );

  if (summary?.summary_markdown) {
    // 加载最近 N 条消息 + 摘要前缀
    const recentRows = db.all<{
      id: string; session_key: string; role: string; content: string;
      tool_calls_json: string | null; created_at: string;
      kernel_message_json: string | null;
    }>(
      `SELECT id, session_key, role, content, tool_calls_json, created_at, kernel_message_json
       FROM conversation_log
       WHERE agent_id = ? AND session_key = ? AND role IN ('user', 'assistant')
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      agentId, sessionKey, limit,
    );

    const recentMessages = dedupeAssistantRows(recentRows.reverse())
      .map(rowToChatMessage)
      .filter((m): m is ChatMessage => m !== null);
    const summaryMsg: ChatMessage = {
      id: `summary-${agentId}`,
      conversationId: sessionKey,
      role: 'user',
      content: `[会话摘要 — 由系统周期性生成]\n\n${summary.summary_markdown}`,
      isSummary: true,
      createdAt: recentMessages[0]?.createdAt ?? new Date().toISOString(),
    };
    return [summaryMsg, ...recentMessages];
  }

  // ── Level 3: 回退到 last-N ──
  const rows = db.all<{
    id: string; session_key: string; role: string; content: string;
    tool_calls_json: string | null; created_at: string;
    kernel_message_json: string | null;
  }>(
    `SELECT id, session_key, role, content, tool_calls_json, created_at, kernel_message_json
     FROM conversation_log
     WHERE agent_id = ? AND session_key = ? AND role IN ('user', 'assistant')
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
    agentId, sessionKey, limit,
  );

  return dedupeAssistantRows(rows.reverse())
    .map(rowToChatMessage)
    .filter((m): m is ChatMessage => m !== null);
}

/**
 * 数据库行 → ChatMessage
 *
 * 返回 null 表示该消息不应在 UI / LLM 历史中展示（如纯 tool_result）。
 *
 * 优先路径：若 kernel_message_json 可解析 → 精确重建
 *   - shouldDisplayMessage 过滤纯 tool_result / 纯 thinking
 *   - content 只取 text 块（剥离 thinking/tool_use 摘要）
 *   - toolCalls 从 tool_use 块重建（让前端走工具卡片渲染路径）
 * 降级路径：row.content 原样 + 占位符重建（修存量无 kernel_message_json 的行）
 */
function rowToChatMessage(row: {
  id: string; session_key: string; role: string; content: string;
  tool_calls_json: string | null; created_at: string;
  kernel_message_json?: string | null;
}): ChatMessage | null {
  // 优先：从 kernel_message_json 精确重建
  if (row.kernel_message_json) {
    try {
      const kmsg = JSON.parse(row.kernel_message_json) as KernelMessage;
      if (!shouldDisplayMessage(kmsg)) return null; // 过滤纯 tool_result / 空消息

      const msg: ChatMessage = {
        id: row.id,
        conversationId: row.session_key,
        role: row.role as ChatMessage['role'],
        content: extractTextOnly(kmsg),
        createdAt: row.created_at,
      };
      const toolCalls = extractToolCallsForUI(kmsg);
      if (toolCalls) (msg as any).toolCalls = toolCalls;
      return msg;
    } catch {
      // JSON 损坏 → 降级
    }
  }

  // 降级：原样返回 + 占位符修复（存量无 kernel_message_json 的老数据）
  const displayContent = reconstructDisplayContent(row.content, row.kernel_message_json ?? null);
  const msg: ChatMessage = {
    id: row.id,
    conversationId: row.session_key,
    role: row.role as ChatMessage['role'],
    content: displayContent,
    createdAt: row.created_at,
  };
  if (row.tool_calls_json) {
    try { (msg as any).toolCalls = JSON.parse(row.tool_calls_json); } catch { /* ignore */ }
  }
  return msg;
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
  cronRunner?: import('../scheduler/cron-runner.js').CronRunner,
  costTracker?: import('../cost/cost-tracker.js').CostTracker,
  sessionSummarizer?: import('../memory/session-summarizer.js').SessionSummarizer,
  getMcpManager?: () => import('../mcp/mcp-client.js').McpManager | undefined,
  memoryStore?: MemoryStore,
  ftsStore?: FtsStore,
  knowledgeGraph?: KnowledgeGraphStore,
) {
  const app = new Hono();

  /**
   * 生成会话标题 —— 剥离 <quoted_message> 前缀后取前 30 字
   *
   * 用户引用消息时 DB 存的 user content 头部是一段 XML 标签，直接 slice 会
   * 把 `<quoted_message id="...` 当成标题，读不出语义。
   */
  const makeTitle = (content: string | undefined): string => {
    if (!content) return '新对话';
    const { rest } = parseQuotedPrefix(content);
    const text = rest.trim();
    if (!text) return '新对话';
    return text.slice(0, 30) + (text.length > 30 ? '...' : '');
  };

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
           AND cl.session_key NOT LIKE '%:boot'
           AND cl.session_key NOT LIKE '%:heartbeat%'
           AND cl.session_key NOT LIKE '%:cron:%'
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
      const title = makeTitle(firstUserMsg?.content);
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
           AND cl.session_key NOT LIKE '%:boot'
           AND cl.session_key NOT LIKE '%:heartbeat%'
           AND cl.session_key NOT LIKE '%:cron:%'
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
      const title = makeTitle(firstUserMsg?.content);
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
    type SendBody = { message?: string; sessionKey?: string; isHeartbeat?: boolean; lightContext?: boolean; modelOverride?: string };
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

    // Skill 系统插件（含 Agent 级启用/禁用过滤 + MCP Prompt 桥接 + IT 管理员安全策略）
    contextEngine.register(createToolRegistryPlugin({
      getDisabledSkills: (aId) => {
        const rows = store.all<{ skill_name: string }>(
          'SELECT skill_name FROM agent_skills WHERE agent_id = ? AND enabled = 0',
          aId,
        );
        return new Set(rows.map(r => r.skill_name));
      },
      // MCP Prompt → Skill 桥接：将所有 MCP server 的 prompts 作为 mcp:{server}:{name} 注入 <available_skills>
      mcpPromptsProvider: () => {
        const mgr = getMcpManager?.();
        if (!mgr) return [];
        return bridgeAllMcpPrompts(mgr.getAllPrompts());
      },
      // IT 管理员级安全策略（allowlist/denylist/disabled）— beforeTurn 过滤 available_skills
      securityPolicy: configManager?.getSkillSecurityPolicy(),
    }));                  // Tier 1: <available_skills> 目录注入
    contextEngine.register(createGapDetectionPlugin(skillDiscoverer));   // afterTurn: 能力缺口检测 + Skill 推荐
    if (sessionSummarizer) {
      const { createSessionSummaryPlugin } = await import('../context/plugins/session-summary.js');
      contextEngine.register(createSessionSummaryPlugin(sessionSummarizer));
    }

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
    const turnCtx: TurnContext = {
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

    // TodoWrite 3 轮提醒 — 若连续 3 轮未调用 todo_write 且有未完成任务，注入提醒
    const todoTurnsSinceUpdate = parseInt(
      agentManager.getWorkspaceState(agentId, 'todo_turns_since_update') ?? '0',
    );
    if (todoTurnsSinceUpdate >= 3) {
      try {
        const todoRaw = agentManager.readWorkspaceFile(agentId, 'TODO.json');
        if (todoRaw) {
          const todoTasks = JSON.parse(todoRaw) as Array<{ status: string }>;
          if (Array.isArray(todoTasks) && todoTasks.some(t => t.status !== 'done')) {
            turnCtx.injectedContext.push(
              '[System] 你已经 3 轮没有更新任务列表了。请用 todo_write 工具检查并更新你的任务进度。',
            );
          }
        }
      } catch { /* malformed TODO.json, skip reminder */ }
    }

    // 组装最终 system prompt
    const systemPrompt = turnCtx.injectedContext.join('\n\n---\n\n');

    // 根据 session 类型选择加载的文件（参考 OpenClaw 的分层策略）
    const ALL_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'TODO.json'];
    const MINIMAL_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'];
    const HEARTBEAT_FILES = ['HEARTBEAT.md', 'AGENTS.md'];

    const isSubAgent = sessionKey.includes(':subagent:');
    const isCron = sessionKey.includes(':cron:');
    const isHeartbeat = body.isHeartbeat === true;
    const isLightContext = isHeartbeat && body.lightContext === true;

    const LIGHT_FILES = ['HEARTBEAT.md'];
    const filesToLoad = isLightContext ? LIGHT_FILES : isHeartbeat ? HEARTBEAT_FILES : (isSubAgent || isCron) ? MINIMAL_FILES : ALL_FILES;

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
    const secondaryLLMCall = configManager ? createSecondaryLLMCallFn(configManager) : undefined;
    // M8: 域名黑名单 — 通过 getter 支持热重载
    const getDomainDenylist = () => configManager?.getConfig().security?.domainDenylist;
    enhancedTools.push(createWebFetchTool({ llmCall: secondaryLLMCall, domainDenylist: getDomainDenylist }));

    // 记忆和知识图谱工具（read: search/get/knowledge_query；write: write/update/delete/forget_topic/pin）
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
    enhancedTools.push(createExecBackgroundTool({ agentId, sessionKey }));
    enhancedTools.push(createProcessTool());

    // TodoWrite 约束工具 — 结构化任务追踪
    enhancedTools.push(createTodoWriteTool({
      readFile: () => agentManager.readWorkspaceFile(agentId, 'TODO.json'),
      writeFile: (c) => agentManager.writeWorkspaceFile(agentId, 'TODO.json', c),
    }));

    // 定时调度工具 — 一次性提醒 + 周期性任务
    if (cronRunner) {
      enhancedTools.push(...createScheduleTool({ cronRunner, agentId, sessionKey }));
    }

    // 查 extension 获取模型参数（用于 contextWindow/maxTokens）
    const modelDef = lookupModelDefinition(provider, modelId);

    // 子 Agent 工具（需 laneQueue）
    let spawner: SubAgentSpawner | undefined;
    // 权限冒泡管理器 — 子 Agent 工具需要用户授权时暂停等待
    let bubbleManager: PermissionBubbleManager | undefined;
    // SSE 发射函数引用（在 streamSSE 回调内绑定实际 stream）
    const permissionEmitter: { emit: ((data: string) => void) | null } = { emit: null };
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
      bubbleManager = new PermissionBubbleManager();

      spawner = new SubAgentSpawner(
        runConfigForSpawner, laneQueue, 0,
        (taskId, task, result, success) => {
          log.info(`子 Agent ${taskId} ${success ? '完成' : '失败'}: ${task.slice(0, 50)}`);
        },
        workspaceFiles, agentResolver,
        undefined,                                     // allowAgents
        undefined,                                     // maxSpawnDepth（使用默认值）
        undefined,                                     // getParentMessages
        runConfigForSpawner.permissionInterceptFn,      // 权限拦截传递给子 Agent
        bubbleManager,                                 // 权限冒泡管理器
        (request) => {                                 // 权限冒泡 SSE 发射
          permissionEmitter.emit?.(JSON.stringify({
            ...request,
            isSubagent: true,
          }));
        },
      );
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

    // ─── MCP 工具桥接（按 Agent 配置过滤） ───
    const mcpManager = getMcpManager?.();
    if (mcpManager) {
      const existingNames = new Set(enhancedTools.map(t => t.name));
      const mcpTools = bridgeMcpToolsForAgent(mcpManager, agent.mcpServers, existingNames);
      enhancedTools.push(...mcpTools);
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

    // 权限模式: Agent 级覆盖 → 全局配置 → 默认
    const permissionMode = agent.permissionMode
      ?? configManager?.getConfig().permissionMode
      ?? 'default';
    interceptor.setMode(permissionMode);

    // 拒绝追踪器 — 防止工具无限循环
    const denialTracker = new DenialTracker();
    denialTracker.setMode(permissionMode);

    // 记录本次对话中需要弹窗的权限请求（流结束后随最后一批 SSE 事件到达前端）
    const pendingPermissions: Array<{
      requestId: string;
      toolName: string;
      category: string;
      resource: string;
      reason?: string;
      /** Smart Approve escalate 时的 LLM 评估结果，供前端展示"AI 评估理由" */
      smartApprove?: { decision: 'escalate'; reason: string };
    }> = [];

    // 自主执行会话标记（heartbeat/cron/boot）— 无人值守，权限策略不同
    const isAutonomousSession = isHeartbeat || isCron || sessionKey.includes(':boot');

    // 破坏性操作待发通知（permissionInterceptFn 设置，onEvent 消费）
    let pendingDestructive: { toolName: string; category?: string; warning: string } | null = null;

    // smart-approve session 缓存（一次 chat 请求内复用决策，省 LLM 调用）
    const smartCache = new SmartDecisionCache();

    const permissionInterceptFn = async (toolName: string, args: Record<string, unknown>): Promise<string | null> => {
      const result = interceptor.intercept(agentId, toolName, args, sessionKey);

      // Smart Approve：mode === 'smart' 且静态分析需要确认时调辅助 LLM 评估
      // escalate 时把 reason 带到 pendingPermissions，前端弹窗展示"AI 评估理由"
      let smartEscalate: { decision: 'escalate'; reason: string } | undefined;
      if (
        !result.allowed &&
        result.requiresConfirmation &&
        interceptor.getMode() === 'smart' &&
        smartShouldEvaluate(toolName) &&
        configManager
      ) {
        const llmCall = createSecondaryLLMCallFn(configManager);
        const decision = await smartEvaluateRisk(
          { toolName, params: args, recentUserMessage: messages[messages.length - 1]?.content, sessionKey },
          llmCall,
          smartCache,
        );
        if (decision.decision === 'approve') {
          log.info(`[smart-approve] approve ${toolName}: ${decision.reason}`);
          denialTracker.recordSuccess();
          return null; // 放行
        }
        if (decision.decision === 'deny') {
          log.warn(`[smart-approve] deny ${toolName}: ${decision.reason}`);
          denialTracker.recordDenial();
          return `[智能评估拒绝] ${decision.reason}`;
        }
        // escalate → 落到下方原有 ask 流程
        log.info(`[smart-approve] escalate ${toolName}: ${decision.reason}`);
        smartEscalate = { decision: 'escalate', reason: decision.reason };
      }

      if (!result.allowed && result.requiresConfirmation) {
        // 拒绝追踪
        const denialResult = denialTracker.recordDenial();
        if (denialResult.limitReached) {
          log.warn(`[拒绝上限] 连续 ${denialResult.count} 次拒绝，session=${sessionKey}`);
          return `连续 ${denialResult.count} 次权限拒绝，已达上限。请检查权限配置或切换权限模式。`;
        }

        if (isAutonomousSession) {
          // 自主执行会话：无人值守，静默跳过需授权的工具（不弹窗）
          const category = result.permissionCategory ?? 'skill';
          log.info(`[自主执行] 跳过需授权工具 ${toolName}(${category}), session=${sessionKey}`);
          return `[自主执行模式] 工具 "${toolName}" 需要「${category}」权限，当前为无人值守会话，已跳过。如需使用此工具，请在对话中手动执行。`;
        }
        // 普通会话：记录待弹窗的权限请求
        const category = result.permissionCategory ?? 'skill';
        const resource = (args['path'] as string) ?? (args['file_path'] as string) ?? (args['command'] as string) ?? '*';
        pendingPermissions.push({
          requestId: crypto.randomUUID(),
          toolName,
          category,
          resource,
          reason: result.reason,
          smartApprove: smartEscalate,
        });
        return `需要「${category}」权限才能执行此操作。请在弹出的权限对话框中授权后重新发送消息。`;
      }

      if (!result.allowed && !result.requiresConfirmation) {
        denialTracker.recordDenial();
        return result.reason ?? '操作被拒绝';
      }

      // 成功 — 重置拒绝计数器
      denialTracker.recordSuccess();

      // 破坏性操作标记 — 附加到待发 SSE 事件供前端确认
      if (result.isDestructive) {
        pendingDestructive = {
          toolName,
          category: result.destructiveCategory,
          warning: result.destructiveWarning ?? '此操作可能造成不可逆影响',
        };
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
      sessionKey,
      tools,
      messages,
      store,
      mcpManager,
      contextWindow: modelDef?.contextWindow,
      maxTokens: modelDef?.maxTokens,
      promptOverrides: (body as any).promptOverrides,
      thinkingMode: configManager?.getThinkingMode(),
      language: configManager?.getLanguage(),
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
      // Tool Summary: 使用低成本模型 + cache_control 生成工具调用摘要
      toolSummaryGeneratorFn: configManager
        ? async (_system: string, user: string) => {
            const { callLLMSecondaryCached } = await import('../agent/llm-client.js');
            return callLLMSecondaryCached(configManager, 'tool_summary', user, { maxTokens: 256 });
          }
        : undefined,
      // Grace Call（M3-T1）：普通会话启用；自主会话（heartbeat/cron/boot）禁用，
      // 避免无人值守场景每次预算耗尽都多一次 LLM 调用浪费 token。
      graceCallEnabled: !isAutonomousSession,
      // Compact 后置钩子: 持久化压缩边界 + 摘要
      postCompactHook: async (trigger, tokensBefore, tokensAfter, summaryText) => {
        try {
          // 1. 写入 compaction_boundary 到 conversation_log
          store.run(
            `INSERT INTO conversation_log (id, agent_id, session_key, role, content, compaction_status, entry_type, created_at)
             VALUES (?, ?, ?, 'system', ?, 'compacted', 'compaction_boundary', ?)`,
            crypto.randomUUID(), agentId, sessionKey,
            JSON.stringify({ trigger, tokensBefore, tokensAfter }),
            new Date().toISOString(),
          );

          // 2. 持久化摘要到 session_summaries（仅 autocompact 产生摘要时）
          if (summaryText && sessionSummarizer) {
            sessionSummarizer.save(agentId, sessionKey, summaryText, tokensAfter, 0, 0);
          }
        } catch (err) {
          log.warn(`PostCompact Hook 持久化失败: ${err instanceof Error ? err.message : err}`);
        }
        return {};
      },
      // 模型解析器: 将 skill 的 model 字段 "provider/modelId" 解析为 API 配置
      modelResolver: configManager
        ? (modelRef: string) => {
            // 简单解析 "provider/modelId" 格式
            const slashIdx = modelRef.indexOf('/');
            if (slashIdx <= 0 || slashIdx === modelRef.length - 1) return undefined;
            const provId = modelRef.slice(0, slashIdx);
            const modId = modelRef.slice(slashIdx + 1);
            const prov = configManager.getProvider(provId);
            if (!prov?.apiKey || !prov.baseUrl) return undefined;
            const mod = prov.models.find(m => m.id === modId);
            if (!mod) return undefined;
            return {
              protocol: prov.api ?? 'openai-completions',
              baseUrl: prov.baseUrl,
              apiKey: prov.apiKey,
              modelId: modId,
              contextWindow: mod.contextWindow ?? 128_000,
            };
          }
        : undefined,
    };

    // 审计日志异步队列（内存缓存 + Agent 结束后批量写入）
    const auditQueue = new ToolAuditQueue(store);

    // 存储用户消息（heartbeat 会话延迟到响应后判断，避免零污染回滚时残留）
    if (!isHeartbeat) {
      saveMessage(store, agentId, sessionKey, 'user', message);
    }

    // System Events 注入 — drain 待处理事件（噪音过滤 + 时间戳格式化），前缀拼接到 LLM 输入消息
    const systemLines = drainFormattedSystemEvents(sessionKey);
    const effectiveMessage = systemLines.length > 0
      ? `System:\n${systemLines.map(l => `  ${l}`).join('\n')}\n\n${message}`
      : message;

    // 返回 SSE 流
    const startTime = Date.now();

    // SSE 回调体 — Bun/Node 共用，通过 stream 接口抽象
    type SSEWriter = {
      writeSSE(msg: { data: string; event?: string }): Promise<void>;
      onAbort(cb: () => void): void;
    };
    const sseCallback = async (stream: SSEWriter) => {
      let fullResponse = '';

      // 绑定权限冒泡 SSE 发射函数
      permissionEmitter.emit = (data: string) => {
        stream.writeSSE({ event: 'permission_required', data }).catch(() => { /* SSE 已关闭 */ });
      };

      // ─── Sub-Agent 进度推送定时器 ───
      let progressTimer: ReturnType<typeof setInterval> | undefined;
      let cleanupCounter = 0;
      const startSubagentProgressPush = () => {
        if (!spawner) return;
        progressTimer = setInterval(async () => {
          // 每 15 次（约 30s）执行一次资源清理
          if (++cleanupCounter % 15 === 0) {
            spawner!.cleanup();
          }
          const snapshot = spawner!.getProgressSnapshot();
          for (const entry of snapshot) {
            try {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'subagent_progress',
                  timestamp: Date.now(),
                  subagentProgress: {
                    taskId: entry.taskId,
                    agentType: entry.agentType,
                    task: entry.task.slice(0, 200),
                    status: entry.status,
                    progress: {
                      ...entry.progress,
                      durationMs: Date.now() - entry.startedAt,
                    },
                  },
                }),
              });
            } catch { /* SSE 已关闭，忽略 */ }
          }
          // 推送结构化完成通知
          const notifications = spawner!.drainStructuredAnnouncements();
          for (const n of notifications) {
            // 1. 推 SSE 给前端（前端 UX）
            try {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'subagent_notification',
                  timestamp: Date.now(),
                  subagentNotification: {
                    taskId: n.taskId,
                    agentType: n.agentType,
                    task: n.task.slice(0, 200),
                    status: n.status,
                    success: n.success,
                    result: n.result.slice(0, 1000),
                    durationMs: n.durationMs,
                    tokenUsage: n.tokenUsage,
                  },
                }),
              });
            } catch { /* SSE 已关闭，忽略 */ }

            // 2. 入队 SystemEvent — 下一次 user turn 时 LLM 可通过
            //    drainFormattedSystemEvents 看到 <task-notification>，
            //    实现多 Agent 自动协作汇总（无需用户手动追问）。
            //    SSE 关闭（auto_backgrounded）后该入队仍会执行。
            try {
              enqueueTaskNotification(
                {
                  taskId: n.taskId,
                  kind: 'subagent',
                  status:
                    n.status === 'completed' ? 'completed' :
                    n.status === 'cancelled' ? 'cancelled' : 'failed',
                  title: n.task,
                  result: n.success ? n.result : undefined,
                  error: n.success ? undefined : n.result,
                  durationMs: n.durationMs,
                  tokenUsage: n.tokenUsage,
                  agentType: n.agentType,
                },
                sessionKey,
              );
            } catch (err) {
              log.warn(`入队 task-notification 失败 taskId=${n.taskId}: ${err instanceof Error ? err.message : err}`);
            }
          }
        }, 2000);
      };
      const stopSubagentProgressPush = () => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = undefined;
        }
      };

      // ─── 自动后台化机制 ───
      // 超过 autoBackgroundMs 后，停止向 SSE 推送事件（任务继续在后台完成）
      // 前端收到 auto_backgrounded 事件后解锁输入框，用户可继续对话
      const AUTO_BACKGROUND_MS = 60_000; // 60 秒
      let isBackgrounded = false;
      let autoBackgroundTimer: ReturnType<typeof setTimeout> | undefined;

      const runAgent = async (abortSignal?: AbortSignal) => {
        startSubagentProgressPush();

        // 启动自动后台化计时器
        autoBackgroundTimer = setTimeout(async () => {
          if (!isBackgrounded) {
            isBackgrounded = true;
            stopSubagentProgressPush();
            try {
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'auto_backgrounded',
                  timestamp: Date.now(),
                  autoBackgrounded: {
                    taskId: `chat-${agentId}`,
                    reason: 'timeout' as const,
                    elapsedMs: Date.now() - startTime,
                  },
                }),
              });
            } catch { /* SSE 已关闭 */ }
            log.info(`[自动后台化] Agent ${agentId} 执行超过 ${AUTO_BACKGROUND_MS / 1000}s，已后台化 session=${sessionKey}`);
          }
        }, AUTO_BACKGROUND_MS);

        try {
          await runEmbeddedAgent(runConfig, effectiveMessage, async (event) => {
            if (event.type === 'text_delta' && event.delta) {
              fullResponse += event.delta;
            }
            // 成本追踪：始终捕获（即使已后台化，成本仍需记录）
            if (event.type === 'usage' && event.usage && costTracker) {
              costTracker.track({
                agentId,
                sessionKey,
                channel: sessionKey.split(':')[2] ?? 'desktop',
                provider: runConfig.provider,
                model: runConfig.modelId,
                inputTokens: event.usage.inputTokens,
                outputTokens: event.usage.outputTokens,
                cacheReadTokens: event.usage.cacheReadTokens,
                cacheWriteTokens: event.usage.cacheWriteTokens,
                callType: 'chat',
                latencyMs: Date.now() - startTime,
                turnCount: event.usage.turnCount,
              });
            }
            // 后台化后不再向 SSE 推送常规事件（成本追踪除外）
            if (isBackgrounded) return;
            // 破坏性操作标记注入 tool_start 事件
            if (event.type === 'tool_start' && pendingDestructive && event.toolName === pendingDestructive.toolName) {
              event.isDestructive = true;
              pendingDestructive = null; // 消费一次
            }
            await stream.writeSSE({ data: JSON.stringify(event) });
          }, abortSignal);
        } finally {
          if (autoBackgroundTimer) clearTimeout(autoBackgroundTimer);
          stopSubagentProgressPush();
        }
      };

      if (laneQueue) {
        const runId = `chat-${crypto.randomUUID()}`;
        const abortController = new AbortController();

        // SSE 连接关闭时：
        // - 未后台化：取消排队/中止运行
        // - 已后台化：不中止（任务继续执行，结果仍会写入 DB）
        stream.onAbort(() => {
          if (!isBackgrounded) {
            abortController.abort();
            laneQueue.cancel(runId);
          }
          stopSubagentProgressPush();
          // 非后台化时销毁 spawner 释放所有子 Agent 资源
          if (!isBackgrounded) {
            spawner?.dispose();
            bubbleManager?.dispose();
          }
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

      // TodoWrite 轮次计数器更新（在 flush 前检测，flush 会清空队列）
      if (auditQueue.hasToolCall('todo_write')) {
        agentManager.setWorkspaceState(agentId, 'todo_turns_since_update', '0');
      } else {
        const prev = parseInt(agentManager.getWorkspaceState(agentId, 'todo_turns_since_update') ?? '0');
        agentManager.setWorkspaceState(agentId, 'todo_turns_since_update', String(prev + 1));
      }

      // 批量写入审计日志（Agent 完成后一次性写入，避免逐条同步 I/O）
      auditQueue.flush();

      // 存储 assistant 响应（剥离 PI 框架内部的工具调用/响应 XML 标记）
      const cleanResponse = fullResponse
        .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
        .replace(/<function_response>[\s\S]*?<\/function_response>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // Heartbeat 零污染回滚：鲁棒 ACK 检测（支持 Markdown/HTML 包裹、尾随标点等变体）
      const isHeartbeatNoOp = isHeartbeat && detectHeartbeatAck(cleanResponse).isAck;

      if (!isHeartbeatNoOp) {
        // heartbeat 会话的 user 消息延迟到这里保存（非 heartbeat 已在上方保存）
        if (isHeartbeat) {
          saveMessage(store, agentId, sessionKey, 'user', message);
        }
        // Assistant 消息由 IncrementalPersister 在 query-loop 每轮结束后逐条持久化
        // （含 text + tool_use + thinking 完整结构，存于 kernel_message_json 字段）。
        // 此处不再重复 saveMessage(cleanResponse)，避免产生不含 kernel_message_json 的
        // 冗余行导致前端消息重复展示和顺序混乱。
        // 通知其他 SSE 监听者（其他页面/窗口）会话已更新
        emitServerEvent({
          type: 'conversations-changed',
          data: { agentId, sessionKey },
        });
      }

      // Sprint 15.12 Phase C — 召回元数据透传
      // memory-recall 插件在 beforeTurn 把召回的 memoryIds + scores 写入 turnCtx.recallMeta
      // 流结束前发给前端，用于"Show Your Work"折叠条
      if (turnCtx.recallMeta && turnCtx.recallMeta.memoryIds.length > 0) {
        await stream.writeSSE({
          event: 'recall_meta',
          data: JSON.stringify(turnCtx.recallMeta),
        });
      }

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
    };

    // Bun: 绕过 Hono 中间件的 Response 包装，使用原生 ReadableStream 确保逐条 flush
    // Node: 继续使用 Hono streamSSE（@hono/node-server 基于 node:http，flush 正常）
    if (isBun) {
      const sseResponse = createBunSSEResponse((bunStream) => sseCallback(bunStream), c.req.raw.signal);
      // 存入 WeakMap，Bun.serve 层会用此 Response 替换 Hono 包装后的版本
      bunSSEResponses.set(c.req.raw, sseResponse);
      // 返回空 dummy Response 给 Hono — Hono 中间件可以任意包装它，
      // 但实际发送给客户端的是 WeakMap 中的原始 SSE Response。
      // 用 x-sse-bypass header 作为标记，避免误匹配其他请求。
      return new Response('', { headers: { 'x-sse-bypass': '1' } });
    }
    return streamSSE(c, (honoStream) => sseCallback(honoStream));
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

  /** POST /:agentId/fork — Fork 会话（基于现有会话创建独立副本） */
  app.post('/:agentId/fork', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ sourceSessionKey: string; newSessionKey?: string }>()
      .catch((): { sourceSessionKey: string; newSessionKey?: string } => ({ sourceSessionKey: '' }));

    if (!body.sourceSessionKey) {
      return c.json({ error: '缺少 sourceSessionKey' }, 400);
    }

    const { forkSession } = await import('./fork-session.js');
    const result = forkSession(store, agentId, body.sourceSessionKey, body.newSessionKey);

    if (!result.success) {
      return c.json({ error: result.error }, 500);
    }
    return c.json(result);
  });

  return app;
}
