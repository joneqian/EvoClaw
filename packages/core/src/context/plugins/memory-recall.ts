import type { ContextPlugin, TurnContext, CompactContext } from '../plugin.interface.js';
import type { HybridSearcher } from '../../memory/hybrid-searcher.js';
import { wrapMemoryContext } from '../../memory/text-sanitizer.js';
import type { ChatMessage } from '@evoclaw/shared';

/** 创建记忆召回插件 */
export function createMemoryRecallPlugin(searcher: HybridSearcher): ContextPlugin {
  return {
    name: 'memory-recall',
    priority: 40,

    async beforeTurn(ctx: TurnContext) {
      // 从最后一条用户消息提取查询
      const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) return;

      const results = await searcher.hybridSearch(lastUserMsg.content, ctx.agentId, {
        limit: 10,
      });

      if (results.length === 0) return;

      // 组装记忆上下文（L0 + L1）
      const memoryBlock = results.map(r => {
        const detail = r.l2Content ? `\n详情: ${r.l2Content}` : '';
        return `- [${r.category}] ${r.l0Index}\n  ${r.l1Overview}${detail}`;
      }).join('\n');

      // 用标记包裹，防止反馈循环
      ctx.injectedContext.push(wrapMemoryContext(`## 相关记忆\n${memoryBlock}`));

      // 更新 token 估算
      ctx.estimatedTokens += Math.ceil(memoryBlock.length / 4);
    },

    async compact(ctx: CompactContext): Promise<ChatMessage[]> {
      // 压缩模式：降级为仅注入 L0
      // 这里不修改消息，由 context-assembler 处理
      return ctx.messages;
    },
  };
}
