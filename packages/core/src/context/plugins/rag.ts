/**
 * RAG 插件 — beforeTurn 注入知识库检索结果
 *
 * priority: 50（在 memory-recall(40) 之后执行）
 */

import type { ContextPlugin, TurnContext, CompactContext } from '../plugin.interface.js';
import type { VectorStore } from '../../infrastructure/db/vector-store.js';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { wrapRAGContext } from '../../memory/text-sanitizer.js';
import type { ChatMessage } from '@evoclaw/shared';

/** RAG 文档片段 */
interface RAGFragment {
  chunkId: string;
  content: string;
  fileName: string;
  score: number;
}

/** RAG Token 预算 */
const RAG_TOKEN_BUDGET = 4096;

/** 创建 RAG 插件 */
export function createRagPlugin(vectorStore: VectorStore, db: SqliteStore): ContextPlugin {
  return {
    name: 'rag',
    priority: 50,

    async beforeTurn(ctx: TurnContext) {
      // 如果没有 embeddingFn，跳过
      if (!vectorStore.hasEmbeddingFn) return;

      // 从最后一条用户消息提取查询
      const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) return;

      // 向量搜索知识库 chunks
      const results = await vectorStore.searchByText(lastUserMsg.content, 10, 'chunk');
      if (results.length === 0) return;

      // 加载 chunk 内容
      const chunkIds = results.map(r => r.memoryId);
      const placeholders = chunkIds.map(() => '?').join(', ');
      const chunks = db.all<{
        id: string;
        content: string;
        file_id: string;
        token_count: number;
      }>(
        `SELECT c.id, c.content, c.file_id, c.token_count
         FROM knowledge_base_chunks c
         WHERE c.id IN (${placeholders})`,
        ...chunkIds,
      );

      if (chunks.length === 0) return;

      // 加载文件名
      const fileIds = [...new Set(chunks.map(c => c.file_id))];
      const filePlaceholders = fileIds.map(() => '?').join(', ');
      const files = db.all<{ id: string; file_name: string }>(
        `SELECT id, file_name FROM knowledge_base_files WHERE id IN (${filePlaceholders})`,
        ...fileIds,
      );
      const fileNameMap = new Map(files.map(f => [f.id, f.file_name]));

      // 组装 fragments 并按相似度排序
      const scoreMap = new Map(results.map(r => [r.memoryId, r.score]));
      const fragments: RAGFragment[] = chunks
        .map(c => ({
          chunkId: c.id,
          content: c.content,
          fileName: fileNameMap.get(c.file_id) ?? '未知文件',
          score: scoreMap.get(c.id) ?? 0,
        }))
        .sort((a, b) => b.score - a.score);

      // Token 预算控制
      let tokenBudget = RAG_TOKEN_BUDGET;
      const selected: RAGFragment[] = [];
      for (const frag of fragments) {
        const estimatedTokens = Math.ceil(frag.content.length / 4);
        if (estimatedTokens <= tokenBudget) {
          selected.push(frag);
          tokenBudget -= estimatedTokens;
        }
        if (tokenBudget <= 0) break;
      }

      if (selected.length === 0) return;

      // 格式化 RAG 上下文
      const ragBlock = selected.map(f =>
        `### 来源: ${f.fileName}\n${f.content}`
      ).join('\n\n---\n\n');

      ctx.injectedContext.push(wrapRAGContext(`## 相关知识库文档\n\n${ragBlock}`));
      ctx.estimatedTokens += RAG_TOKEN_BUDGET - tokenBudget;
    },

    async compact(ctx: CompactContext): Promise<ChatMessage[]> {
      // 压缩模式：移除 RAG 注入的内容（由标记识别）
      return ctx.messages;
    },
  };
}
