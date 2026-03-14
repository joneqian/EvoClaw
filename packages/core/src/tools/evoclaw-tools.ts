/**
 * EvoClaw 特定工具 — 阶段 3 注入
 * 提供记忆搜索、记忆详情、知识图谱查询等 Agent 可用工具
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { KnowledgeGraphStore } from '../memory/knowledge-graph.js';

/** 创建 EvoClaw 工具集 */
export function createEvoClawTools(deps: {
  searcher: HybridSearcher;
  memoryStore: MemoryStore;
  knowledgeGraph: KnowledgeGraphStore;
  agentId: string;
}): ToolDefinition[] {
  const { searcher, memoryStore, knowledgeGraph, agentId } = deps;

  return [
    {
      name: 'memory_search',
      description: '搜索 Agent 的记忆库，返回与查询相关的记忆片段。用于回忆用户偏好、历史事件、之前的对话要点等。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或自然语言查询' },
          limit: { type: 'number', description: '返回结果数量（默认 5）' },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const query = args['query'] as string;
        const limit = (args['limit'] as number) ?? 5;
        if (!query) return '错误：缺少 query 参数';

        const results = await searcher.hybridSearch(query, agentId, { limit });
        if (results.length === 0) return '未找到相关记忆。';

        const formatted = results.map((r, i) =>
          `${i + 1}. [${r.category}] ${r.l0Index}\n   ${r.l1Overview}`
        ).join('\n');
        return `找到 ${results.length} 条相关记忆：\n${formatted}`;
      },
    },
    {
      name: 'memory_get',
      description: '获取单条记忆的完整详情（L2 层内容）。先通过 memory_search 找到记忆 ID，再用此工具获取详情。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记忆 ID' },
        },
        required: ['id'],
      },
      execute: async (args) => {
        const id = args['id'] as string;
        if (!id) return '错误：缺少 id 参数';

        const unit = memoryStore.getById(id);
        if (!unit) return `未找到 ID 为 ${id} 的记忆。`;

        return JSON.stringify({
          id: unit.id,
          category: unit.category,
          l0: unit.l0Index,
          l1: unit.l1Overview,
          l2: unit.l2Content,
          createdAt: unit.createdAt,
          updatedAt: unit.updatedAt,
        }, null, 2);
      },
    },
    {
      name: 'knowledge_query',
      description: '查询知识图谱中的实体关系。搜索与某个实体相关的所有关系三元组（主语-谓语-宾语）。',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: '实体名称或 ID' },
        },
        required: ['entity'],
      },
      execute: async (args) => {
        const entity = args['entity'] as string;
        if (!entity) return '错误：缺少 entity 参数';

        const relations = knowledgeGraph.queryBoth(entity);
        if (relations.length === 0) return `未找到与 "${entity}" 相关的知识图谱关系。`;

        const formatted = relations.map(r =>
          `- ${r.subjectId} → ${r.relation} → ${r.objectId ?? r.objectLiteral ?? '?'} (置信度: ${r.confidence})`
        ).join('\n');
        return `找到 ${relations.length} 条关系：\n${formatted}`;
      },
    },
  ];
}
