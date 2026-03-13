import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AgentManager } from '../agent/agent-manager.js';
import { runEmbeddedAgent } from '../agent/embedded-runner.js';
import type { AgentRunConfig } from '../agent/types.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { FALLBACK_MODEL } from '@evoclaw/shared';

/** 创建聊天路由 */
export function createChatRoutes(store: SqliteStore, agentManager: AgentManager) {
  const app = new Hono();

  app.post('/:agentId/send', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ message?: string }>().catch(() => ({}));
    const message = body.message;

    if (!message) {
      return c.json({ error: '消息不能为空' }, 400);
    }

    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    // 解析模型 — 优先使用 Agent 配置，否则使用全局默认
    const modelId = agent.modelId ?? FALLBACK_MODEL.modelId;
    const provider = agent.provider ?? FALLBACK_MODEL.provider;

    // 查询是否有 model_configs 中的配置
    const modelConfig = store.get<{ api_key_ref: string; config_json: string }>(
      'SELECT api_key_ref, config_json FROM model_configs WHERE provider = ? AND model_id = ? LIMIT 1',
      provider, modelId,
    );
    const configJson = modelConfig ? JSON.parse(modelConfig.config_json) as Record<string, string> : {};
    const baseUrl = (configJson['baseUrl'] as string | undefined) ?? '';

    // 加载工作区文件
    const workspaceFiles: Record<string, string> = {};
    for (const file of ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md', 'MEMORY.md']) {
      const content = agentManager.readWorkspaceFile(agentId, file);
      if (content) workspaceFiles[file] = content;
    }

    const runConfig: AgentRunConfig = {
      agent,
      systemPrompt: '',
      workspaceFiles,
      modelId,
      provider,
      apiKey: '', // 生产环境从 Keychain 获取
      baseUrl,
    };

    // 返回 SSE 流
    return streamSSE(c, async (stream) => {
      await runEmbeddedAgent(runConfig, message, async (event) => {
        await stream.writeSSE({ data: JSON.stringify(event) });
      });
    });
  });

  return app;
}
