import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { MemoryExtractor } from '../../memory/memory-extractor.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('memory-extract');

/** 检测消息中是否包含记忆相关工具调用 */
function hasMemoryToolCalls(messages: TurnContext['messages']): boolean {
  const memoryToolNames = new Set(['memory_search', 'memory_get', 'knowledge_query']);
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    // 检查 tool_use 块（content 可能是数组格式）
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null && 'type' in block) {
          const b = block as { type: string; name?: string };
          if (b.type === 'tool_use' && b.name && memoryToolNames.has(b.name)) {
            return true;
          }
        }
      }
    }
    // 检查 toolCalls 字段（部分协议格式）
    const toolCalls = (msg as unknown as Record<string, unknown>).toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const call = tc as { function?: { name?: string } };
        if (call.function?.name && memoryToolNames.has(call.function.name)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** 创建记忆提取插件（afterTurn 阶段），含互斥与游标追踪 */
export function createMemoryExtractPlugin(extractor: MemoryExtractor): ContextPlugin {
  // 闭包状态 — 互斥防护
  let lastProcessedMsgId: string | null = null;
  let inProgress = false;

  return {
    name: 'memory-extract',
    priority: 90,

    async afterTurn(ctx: TurnContext) {
      // 安全检测：medium/high 注入时跳过记忆提取，防止记忆污染
      if (ctx.securityFlags?.injectionDetected && ctx.securityFlags.injectionSeverity !== 'low') {
        log.warn(`检测到注入 (${ctx.securityFlags.injectionSeverity})，跳过记忆提取`);
        return;
      }

      // 互斥：已有提取进行中 → 跳过
      if (inProgress) {
        log.warn('记忆提取进行中，跳过本轮');
        return;
      }

      // 游标：最后消息 ID 未变 → 跳过（防重处理）
      const lastMsg = ctx.messages[ctx.messages.length - 1];
      const lastMsgId = (lastMsg as unknown as Record<string, unknown>)?.id as string | undefined;
      if (lastMsgId && lastMsgId === lastProcessedMsgId) {
        log.debug(`消息 ${lastMsgId} 已处理，跳过`);
        return;
      }

      // Agent 本轮已操作记忆工具 → 跳过（避免重复提取）
      if (hasMemoryToolCalls(ctx.messages)) {
        log.info('Agent 本轮已使用记忆工具，跳过自动提取');
        return;
      }

      const msgCount = ctx.messages.length;
      const userMsgs = ctx.messages.filter(m => m.role === 'user');
      const assistantMsgs = ctx.messages.filter(m => m.role === 'assistant');
      const totalContentLen = ctx.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);

      log.info(`记忆提取开始: agent=${ctx.agentId}, 消息=${msgCount} (user=${userMsgs.length}, assistant=${assistantMsgs.length}), 内容总长=${totalContentLen}`);

      for (const m of ctx.messages) {
        log.debug(`  [${m.role}] ${m.content?.length ?? 0} 字符: "${(m.content ?? '').slice(0, 80)}..."`);
      }

      inProgress = true;
      const startTime = Date.now();
      try {
        const result = await extractor.extractAndPersist(ctx.messages, ctx.agentId, ctx.sessionKey);
        const elapsed = Date.now() - startTime;

        if (result.skipped) {
          log.warn(`记忆提取跳过 (${elapsed}ms): 内容不足或 LLM 未提取到记忆（详细原因见 memory-extractor 日志）`);
        } else {
          log.info(`记忆提取完成: ${result.memoryIds.length} 条记忆, ${result.relationCount} 条关系 (${elapsed}ms)`);
          for (const id of result.memoryIds) {
            log.debug(`  新记忆: ${id}`);
          }
        }

        // 更新游标
        if (lastMsgId) {
          lastProcessedMsgId = lastMsgId;
        }
      } catch (err) {
        const elapsed = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`记忆提取失败 (${elapsed}ms): ${errMsg}`);
        // 提取失败不影响对话流程
      } finally {
        inProgress = false;
      }
    },
  };
}
