import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { MemoryExtractor } from '../../memory/memory-extractor.js';

/** 创建记忆提取插件（afterTurn 阶段） */
export function createMemoryExtractPlugin(extractor: MemoryExtractor): ContextPlugin {
  return {
    name: 'memory-extract',
    priority: 90, // afterTurn 执行，优先级不影响顺序

    async afterTurn(ctx: TurnContext) {
      try {
        await extractor.extractAndPersist(ctx.messages, ctx.agentId, ctx.sessionKey);
      } catch (err) {
        // 提取失败不影响对话流程
        console.error('[memory-extract] 记忆提取失败:', err);
      }
    },
  };
}
