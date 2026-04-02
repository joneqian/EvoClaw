import type { ContextPlugin, TurnContext, CompactContext, BootstrapContext, ShutdownContext } from '../plugin.interface.js';
import type { ChatMessage } from '@evoclaw/shared';
import { isGroupChat } from '../../routing/session-key.js';
import { createLogger } from '../../infrastructure/logger.js';
import fs from 'node:fs';
import path from 'node:path';

const log = createLogger('context-assembler');

// ─── 会话级 Prompt 缓存 (Sprint 5) ───

/** 会话级缓存条目 */
interface SessionCacheEntry { content: string; computedAt: number }

/** 会话级缓存（5 分钟 TTL） */
const sessionPromptCache = new Map<string, SessionCacheEntry>();
const SESSION_CACHE_TTL_MS = 300_000;

/** 获取会话缓存或重新计算 */
function getCachedOrCompute(sessionKey: string, key: string, computeFn: () => string): string {
  const cacheKey = `${sessionKey}:${key}`;
  const cached = sessionPromptCache.get(cacheKey);
  if (cached && Date.now() - cached.computedAt < SESSION_CACHE_TTL_MS) {
    return cached.content;
  }
  const content = computeFn();
  sessionPromptCache.set(cacheKey, { content, computedAt: Date.now() });
  return content;
}

/** 清除会话级缓存（含事件日志） */
export function clearSessionPromptCache(sessionKey?: string): void {
  if (sessionKey) {
    let count = 0;
    for (const key of sessionPromptCache.keys()) {
      if (key.startsWith(`${sessionKey}:`)) {
        sessionPromptCache.delete(key);
        count++;
      }
    }
    if (count > 0) log.info(`会话 prompt 缓存已清除: session=${sessionKey}, entries=${count}`);
  } else {
    const count = sessionPromptCache.size;
    sessionPromptCache.clear();
    if (count > 0) log.info(`全局 prompt 缓存已清除: entries=${count}`);
  }
}

/** 单个工作区文件最大字符数 */
const MAX_FILE_CHARS = 20_000;

/** 所有工作区文件总字符数上限 */
const MAX_TOTAL_CHARS = 150_000;

/** 工作区文件加载矩阵 — 哪些文件在哪些阶段加载 */
const FILE_LOAD_MATRIX: Record<string, { bootstrap: boolean; beforeTurn: boolean }> = {
  'SOUL.md':      { bootstrap: true,  beforeTurn: false },
  'IDENTITY.md':  { bootstrap: true,  beforeTurn: false },
  'AGENTS.md':    { bootstrap: true,  beforeTurn: false },
  'TOOLS.md':     { bootstrap: true,  beforeTurn: false },
  'USER.md':      { bootstrap: false, beforeTurn: true },  // 每轮重新加载（动态渲染）
  'MEMORY.md':    { bootstrap: false, beforeTurn: true },  // 每轮重新加载
  'HEARTBEAT.md': { bootstrap: true,  beforeTurn: false },
  'BOOTSTRAP.md': { bootstrap: true,  beforeTurn: false },
};

/** 工作区文件缓存 */
const workspaceCache = new Map<string, Map<string, string>>();

/** 剥离 HTML 注释（用户可在工作区文件中写内部注释，LLM 不应看到） */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** 读取工作区文件（自动剥离 HTML 注释） */
function readWorkspaceFile(workspacePath: string, filename: string): string {
  try {
    const raw = fs.readFileSync(path.join(workspacePath, filename), 'utf-8');
    return stripHtmlComments(raw);
  } catch {
    return '';
  }
}

/** 上下文组装插件 */
export const contextAssemblerPlugin: ContextPlugin = {
  name: 'context-assembler',
  priority: 30,

  async bootstrap(ctx: BootstrapContext) {
    // 预加载 bootstrap 阶段的文件
    const cache = new Map<string, string>();
    for (const [file, matrix] of Object.entries(FILE_LOAD_MATRIX)) {
      if (matrix.bootstrap) {
        cache.set(file, readWorkspaceFile(ctx.workspacePath, file));
      }
    }
    workspaceCache.set(ctx.agentId, cache);
  },

  async beforeTurn(ctx: TurnContext) {
    const cache = workspaceCache.get(ctx.agentId) ?? new Map<string, string>();

    // 加载 beforeTurn 阶段的动态文件
    // Note: workspacePath not available in TurnContext, use cached bootstrap files + injectedContext
    for (const [file, matrix] of Object.entries(FILE_LOAD_MATRIX)) {
      if (matrix.beforeTurn && !cache.has(file)) {
        // 动态文件会在后续插件中通过 injectedContext 注入
      }
    }

    // 组装 system prompt
    const parts: string[] = [];
    // BOOTSTRAP.md 由 buildSystemPrompt 单独处理（含首轮判断），此处不重复注入
    const fullOrder = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md'];

    // 群聊模式：跳过 USER.md 和 MEMORY.md（隐私隔离）
    const groupExcluded = new Set(['USER.md', 'MEMORY.md']);
    const priorityOrder = isGroupChat(ctx.sessionKey)
      ? fullOrder.filter(f => !groupExcluded.has(f))
      : fullOrder;

    let totalChars = 0;
    for (const file of priorityOrder) {
      const content = cache.get(file);
      if (!content) continue;

      // 总量截断：超过上限停止加载剩余文件
      if (totalChars >= MAX_TOTAL_CHARS) {
        const msg = `工作区文件总量超限 (${totalChars}/${MAX_TOTAL_CHARS} 字符)，跳过 ${file} 及后续文件`;
        ctx.warnings.push(msg);
        break;
      }

      // 单文件截断
      let truncated = content;
      if (content.length > MAX_FILE_CHARS) {
        const msg = `文件 ${file} 超长 (${content.length}/${MAX_FILE_CHARS} 字符)，已截断`;
        ctx.warnings.push(msg);
        truncated = content.slice(0, MAX_FILE_CHARS) + '\n...[文件已截断]';
      }

      parts.push(`## ${file}\n${truncated}`);
      totalChars += truncated.length;
    }

    if (parts.length > 0) {
      ctx.injectedContext.push(parts.join('\n\n'));
    }

    // 更新 token 估算
    ctx.estimatedTokens += Math.ceil(totalChars / 4);
  },

  async compact(ctx: CompactContext): Promise<ChatMessage[]> {
    // LCM 压缩：保留最近 3 轮 + 摘要更早消息
    const messages = ctx.messages;
    if (messages.length <= 6) return messages; // 3 轮 = 6 条消息

    const recent = messages.slice(-6);
    const earlier = messages.slice(0, -6);

    // 简单摘要：取每条消息的前 100 字符
    const summary: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: earlier[0]?.conversationId ?? '',
      role: 'system',
      content: `[会话历史摘要]\n${earlier.map(m => `${m.role}: ${m.content.slice(0, 100)}...`).join('\n')}`,
      createdAt: new Date().toISOString(),
    };

    return [summary, ...recent];
  },

  async shutdown(ctx: ShutdownContext) {
    clearSessionPromptCache(ctx.sessionKey);
    if (workspaceCache.has(ctx.agentId)) {
      workspaceCache.delete(ctx.agentId);
      log.info(`工作区文件缓存已清除: agent=${ctx.agentId}`);
    }
  },
};
