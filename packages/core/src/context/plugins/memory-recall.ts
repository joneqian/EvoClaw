import type { ContextPlugin, TurnContext, CompactContext } from '../plugin.interface.js';
import type { HybridSearcher, SearchOptions } from '../../memory/hybrid-searcher.js';
import { wrapMemoryContext } from '../../memory/text-sanitizer.js';
import { isGroupChat } from '../../routing/session-key.js';
import type { ChatMessage } from '@evoclaw/shared';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('memory-recall');

/** 计算新鲜度警告标记 */
function computeStalenessTag(updatedAt: string): string {
  const daysSince = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince > 7) {
    return ` [⚠ 较旧: ${Math.floor(daysSince)}天前，建议验证]`;
  }
  if (daysSince > 1) {
    return ` [⚠ ${Math.floor(daysSince)}天前]`;
  }
  return '';
}

/** 创建记忆召回插件 */
export function createMemoryRecallPlugin(searcher: HybridSearcher): ContextPlugin {
  return {
    name: 'memory-recall',
    priority: 40,

    async beforeTurn(ctx: TurnContext) {
      // 从最后一条用户消息提取查询
      const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) {
        log.debug('无用户消息，跳过记忆召回');
        return;
      }

      log.info(`记忆召回开始: agent=${ctx.agentId}, query="${lastUserMsg.content.slice(0, 60)}..."`);

      // 根据聊天类型决定记忆可见性过滤
      const searchOpts: SearchOptions = { limit: 10 };

      if (isGroupChat(ctx.sessionKey)) {
        searchOpts.visibility = 'shared';
      }

      const startTime = Date.now();
      const results = await searcher.hybridSearch(lastUserMsg.content, ctx.agentId, searchOpts);
      const elapsed = Date.now() - startTime;

      if (results.length === 0) {
        log.info(`记忆召回完成: 未找到相关记忆 (${elapsed}ms)`);
        return;
      }

      log.info(`记忆召回完成: 找到 ${results.length} 条记忆 (${elapsed}ms), 分类: ${[...new Set(results.map(r => r.category))].join(',')}`);

      // 详细日志
      for (const r of results) {
        log.debug(`  [${r.category}] score=${r.finalScore.toFixed(3)} activation=${r.activation.toFixed(2)} "${r.l0Index.slice(0, 50)}"`);
      }

      // 组装记忆上下文（L0 + L1 + 新鲜度警告）
      const memoryBlock = results.map(r => {
        const detail = r.l2Content ? `\n详情: ${r.l2Content}` : '';
        const stalenessTag = computeStalenessTag(r.updatedAt);
        return `- [${r.category}]${stalenessTag} ${r.l0Index}\n  ${r.l1Overview}${detail}`;
      }).join('\n');

      // 用标记包裹，防止反馈循环
      ctx.injectedContext.push(wrapMemoryContext(`## 相关记忆\n${memoryBlock}`));

      // 更新 token 估算
      const tokenEstimate = Math.ceil(memoryBlock.length / 4);
      ctx.estimatedTokens += tokenEstimate;
      log.info(`记忆上下文已注入: ${memoryBlock.length} 字符, ~${tokenEstimate} tokens`);
    },

    async compact(ctx: CompactContext): Promise<ChatMessage[]> {
      log.debug('compact 模式: 保持消息不变');
      return ctx.messages;
    },
  };
}
