import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { MemoryExtractor } from '../../memory/memory-extractor.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('memory-extract');

/** 创建记忆提取插件（afterTurn 阶段） */
export function createMemoryExtractPlugin(extractor: MemoryExtractor): ContextPlugin {
  return {
    name: 'memory-extract',
    priority: 90,

    async afterTurn(ctx: TurnContext) {
      const msgCount = ctx.messages.length;
      const lastMsg = ctx.messages[msgCount - 1];
      // 统计有效内容
      const userMsgs = ctx.messages.filter(m => m.role === 'user');
      const assistantMsgs = ctx.messages.filter(m => m.role === 'assistant');
      const totalContentLen = ctx.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);

      log.info(`记忆提取开始: agent=${ctx.agentId}, 消息=${msgCount} (user=${userMsgs.length}, assistant=${assistantMsgs.length}), 内容总长=${totalContentLen}`);

      // 打印每条消息的摘要
      for (const m of ctx.messages) {
        log.debug(`  [${m.role}] ${m.content?.length ?? 0} 字符: "${(m.content ?? '').slice(0, 80)}..."`);
      }

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
      } catch (err) {
        const elapsed = Date.now() - startTime;
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`记忆提取失败 (${elapsed}ms): ${errMsg}`);
        // 提取失败不影响对话流程
      }
    },
  };
}
