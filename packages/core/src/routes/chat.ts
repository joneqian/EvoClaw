import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import crypto from 'node:crypto';
import { AgentManager } from '../agent/agent-manager.js';
import { runEmbeddedAgent } from '../agent/embedded-runner.js';
import type { AgentRunConfig } from '../agent/types.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ChatMessage } from '@evoclaw/shared';
import { ContextEngine } from '../context/context-engine.js';
import { contextAssemblerPlugin } from '../context/plugins/context-assembler.js';
import { sessionRouterPlugin } from '../context/plugins/session-router.js';
import { resolveModel } from '../provider/model-resolver.js';
import { generateSessionKey } from '../routing/session-key.js';
import { setToolInjectorConfig, getInjectedTools } from '../bridge/tool-injector.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('chat');

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
     ORDER BY created_at DESC
     LIMIT ?`,
    agentId, sessionKey, limit,
  );

  // 反转为时间正序
  return rows.reverse().map(row => ({
    id: row.id,
    conversationId: row.session_key,
    role: row.role as ChatMessage['role'],
    content: row.content,
    createdAt: row.created_at,
  }));
}

/** 存储消息到 conversation_log */
function saveMessage(db: SqliteStore, agentId: string, sessionKey: string, role: string, content: string): void {
  db.run(
    `INSERT INTO conversation_log (id, agent_id, session_key, role, content, compaction_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'raw', datetime('now'))`,
    crypto.randomUUID(), agentId, sessionKey, role, content,
  );
}

/** 创建聊天路由 */
export function createChatRoutes(store: SqliteStore, agentManager: AgentManager, vectorStore?: VectorStore, configManager?: ConfigManager) {
  const app = new Hono();

  app.post('/:agentId/send', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ message?: string; sessionKey?: string }>().catch(() => ({}));
    const message = body.message;

    if (!message) {
      return c.json({ error: '消息不能为空' }, 400);
    }

    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    // 生成 Session Key
    const sessionKey = body.sessionKey ?? generateSessionKey(agentId, 'local', 'direct', 'local-user');

    // 解析模型（4 级优先）
    const resolved = resolveModel({
      agentModelId: agent.modelId,
      agentProvider: agent.provider,
      store,
    });

    // 获取 API Key + Base URL + API 协议（从 evo_claw.json）
    let apiKey = '';
    let baseUrl = resolved.baseUrl || '';
    let apiProtocol = 'openai-completions';

    if (configManager) {
      // 先尝试 Agent 指定的 Provider
      const providerEntry = configManager.getProvider(resolved.provider);
      if (providerEntry) {
        apiKey = providerEntry.apiKey;
        if (!baseUrl) baseUrl = providerEntry.baseUrl;
        apiProtocol = providerEntry.api;
      }
      // 兜底：使用默认 Provider
      if (!apiKey) {
        apiKey = configManager.getDefaultApiKey();
        if (!baseUrl) baseUrl = configManager.getDefaultBaseUrl();
        apiProtocol = configManager.getDefaultApi();
      }
    }

    if (!apiKey) {
      return c.json({ error: '未配置 API Key，请先在设置中配置 LLM Provider' }, 400);
    }

    // 创建 ContextEngine 并注册插件
    const contextEngine = new ContextEngine();
    contextEngine.register(sessionRouterPlugin);
    contextEngine.register(contextAssemblerPlugin);

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

    // 加载工作区文件（用于 embedded-runner 的 buildSystemPrompt）
    const workspaceFiles: Record<string, string> = {};
    for (const file of ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md', 'MEMORY.md']) {
      const content = agentManager.readWorkspaceFile(agentId, file);
      if (content) workspaceFiles[file] = content;
    }

    // 配置工具注入
    setToolInjectorConfig({ agentId });
    const tools = getInjectedTools();

    const runConfig: AgentRunConfig = {
      agent,
      systemPrompt,
      workspaceFiles,
      modelId: resolved.modelId,
      provider: resolved.provider,
      apiKey,
      baseUrl,
      apiProtocol: apiProtocol as AgentRunConfig['apiProtocol'],
      tools,
      messages,
    };

    // 存储用户消息
    saveMessage(store, agentId, sessionKey, 'user', message);

    // 返回 SSE 流
    return streamSSE(c, async (stream) => {
      let fullResponse = '';

      await runEmbeddedAgent(runConfig, message, async (event) => {
        if (event.type === 'text_delta' && event.delta) {
          fullResponse += event.delta;
        }
        await stream.writeSSE({ data: JSON.stringify(event) });
      });

      // 存储 assistant 响应
      if (fullResponse) {
        saveMessage(store, agentId, sessionKey, 'assistant', fullResponse);
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
            content: fullResponse,
            createdAt: new Date().toISOString(),
          },
        ],
      };
      contextEngine.afterTurn(afterTurnCtx).catch((err) => {
        log.error('afterTurn 失败:', err);
      });
    });
  });

  return app;
}
