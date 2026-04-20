/**
 * EvoClaw 特定工具 — 阶段 3 注入
 * 提供记忆搜索/读取/写入/更新/删除/钉选 + 知识图谱查询 + Web 搜索/抓取等 Agent 可用工具
 */

import crypto from 'node:crypto';
import type { MemoryCategory, MemoryUnit, MergeType } from '@evoclaw/shared';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import type { FtsStore } from '../infrastructure/db/fts-store.js';
import { createWebSearchTool } from './web-search.js';
import { createWebFetchTool, type LLMCallFn } from './web-fetch.js';

/** 9 种合法记忆类别 */
const VALID_CATEGORIES: readonly MemoryCategory[] = [
  'profile', 'preference', 'entity', 'event', 'case',
  'pattern', 'tool', 'skill', 'correction',
] as const;

/** 独立类别（每条都是单独事件，不合并） */
const INDEPENDENT_CATEGORIES = new Set<MemoryCategory>(['event', 'case']);

/** 根据 category 推断默认 mergeType */
function defaultMergeType(category: MemoryCategory): MergeType {
  return INDEPENDENT_CATEGORIES.has(category) ? 'independent' : 'merge';
}

/** 创建 EvoClaw 工具集 */
export function createEvoClawTools(deps: {
  searcher: HybridSearcher;
  memoryStore: MemoryStore;
  knowledgeGraph: KnowledgeGraphStore;
  ftsStore: FtsStore;
  agentId: string;
  /** Brave Search API Key（可选，有值时注入 web_search 工具） */
  braveApiKey?: string;
  /** 二级模型调用函数（可选，用于 web_fetch 摘要） */
  secondaryLLMCall?: LLMCallFn;
  /** 调用方已自行添加 web_search/web_fetch 时设为 true，避免重复注册 */
  skipWebTools?: boolean;
  /** M8: 域名黑名单 getter（热重载支持） */
  domainDenylist?: readonly string[] | (() => readonly string[] | undefined);
}): ToolDefinition[] {
  const { searcher, memoryStore, knowledgeGraph, ftsStore, agentId, braveApiKey, secondaryLLMCall, skipWebTools, domainDenylist } = deps;

  const tools: ToolDefinition[] = [];

  // Web 工具（无条件注入 web_fetch，条件注入 web_search）
  if (!skipWebTools) {
    if (braveApiKey) {
      tools.push(createWebSearchTool({ braveApiKey }));
    }
    tools.push(createWebFetchTool({ llmCall: secondaryLLMCall, domainDenylist }));
  }

  // 记忆和知识图谱工具
  tools.push(
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
          `- ${r.subjectId} → ${r.relation} → ${r.objectId ?? '?'} (置信度: ${r.confidence})`
        ).join('\n');
        return `找到 ${relations.length} 条关系：\n${formatted}`;
      },
    },
  );

  // ─────────────────────────────────────────────────────────────────
  // Sprint 15.12 Phase A — 5 个记忆写入工具
  // 用户在对话中明说"记住/忘记/修改/钉选"时，Agent 应立即调用这些工具
  // 写入数据库，避免依赖后台异步抽取，做到即时反馈。
  // ─────────────────────────────────────────────────────────────────

  tools.push(
    {
      name: 'memory_write',
      description:
        '即时把一条新记忆写入 Agent 的记忆库（DB），返回新记忆 id。' +
        '当用户明确说"记住 / 帮我记一下 / 不要忘记 X"时**立即调用此工具**，' +
        '不要等待后台自动抽取。写入成功后再回复用户。',
      parameters: {
        type: 'object',
        properties: {
          l0: { type: 'string', description: '记忆的一行摘要（~50 token，作为检索锚点，写好后不可改）' },
          l1: { type: 'string', description: '记忆的结构化概览（~500 token，用于排序展示）' },
          l2: { type: 'string', description: '记忆的完整内容（可选，未提供时使用 l1）' },
          category: {
            type: 'string',
            description: '记忆类别：profile/preference/entity/event/case/pattern/tool/skill/correction（默认 preference）',
          },
        },
        required: ['l0', 'l1'],
      },
      execute: async (args) => {
        const l0 = args['l0'] as string | undefined;
        const l1 = args['l1'] as string | undefined;
        const l2 = (args['l2'] as string | undefined) ?? l1;
        const categoryArg = (args['category'] as string | undefined) ?? 'preference';

        if (!l0) return '错误：缺少 l0 参数（一行摘要）';
        if (!l1) return '错误：缺少 l1 参数（结构化概览）';
        if (!VALID_CATEGORIES.includes(categoryArg as MemoryCategory)) {
          return `错误：非法的 category "${categoryArg}"。合法值：${VALID_CATEGORIES.join(', ')}`;
        }
        const category = categoryArg as MemoryCategory;
        const mergeType = defaultMergeType(category);

        const now = new Date().toISOString();
        const unit: MemoryUnit = {
          id: crypto.randomUUID(),
          agentId,
          category,
          mergeType,
          mergeKey: mergeType === 'merge' ? `${category}:${l0.slice(0, 32)}` : null,
          l0Index: l0,
          l1Overview: l1,
          l2Content: l2 ?? l1,
          confidence: 0.9, // 用户显式指令，高置信度
          activation: 1.0,
          accessCount: 0,
          visibility: 'private',
          sourceConversationId: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };

        memoryStore.insert(unit);
        return `已记住（id=${unit.id}）：${l0}`;
      },
    },
    {
      name: 'memory_update',
      description:
        '更新现有记忆的概述（l1）或详情（l2）。当用户说"修改 / 改一下 / 不对，应该是 X" 等' +
        '需要纠正已有记忆时调用。注意：l0 字段（检索锚点）不可通过此工具修改。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要更新的记忆 id' },
          l1: { type: 'string', description: '新的结构化概览（可选）' },
          l2: { type: 'string', description: '新的完整内容（可选）' },
        },
        required: ['id'],
      },
      execute: async (args) => {
        const id = args['id'] as string | undefined;
        const l1 = args['l1'] as string | undefined;
        const l2 = args['l2'] as string | undefined;

        if (!id) return '错误：缺少 id 参数';

        const existing = memoryStore.getById(id);
        if (!existing) return `未找到 id 为 ${id} 的记忆`;
        if (existing.agentId !== agentId) {
          return '错误：权限不足，无法修改其他 Agent 的记忆';
        }

        if (l1 === undefined && l2 === undefined) {
          return '错误：至少需要提供 l1 或 l2 中的一个字段';
        }

        const partial: Partial<Pick<MemoryUnit, 'l1Overview' | 'l2Content'>> = {};
        if (l1 !== undefined) partial.l1Overview = l1;
        if (l2 !== undefined) partial.l2Content = l2;

        memoryStore.update(id, partial);
        return `已更新记忆 ${id}`;
      },
    },
    {
      name: 'memory_delete',
      description:
        '软删除（归档）一条记忆。当用户说"删掉这条 / 把 X 那条记忆删了" 时调用。' +
        '注意：先用 memory_search 找到 id，再调用此工具。归档后不会出现在召回结果中，但可恢复。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的记忆 id' },
        },
        required: ['id'],
      },
      execute: async (args) => {
        const id = args['id'] as string | undefined;
        if (!id) return '错误：缺少 id 参数';

        const existing = memoryStore.getById(id);
        if (!existing) return `未找到 id 为 ${id} 的记忆`;
        if (existing.agentId !== agentId) {
          return '错误：权限不足，无法删除其他 Agent 的记忆';
        }

        memoryStore.archive(id);
        return `已删除记忆：${existing.l0Index}`;
      },
    },
    {
      name: 'memory_forget_topic',
      description:
        '按关键词批量遗忘某个话题的所有相关记忆。当用户说"忘掉所有关于 X 的事 / 别再提 X" 时调用。' +
        '内部走 FTS5 全文检索，软删除（归档）所有匹配条目，返回归档数量。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '话题关键词（支持中英文）' },
        },
        required: ['keyword'],
      },
      execute: async (args) => {
        const keyword = args['keyword'] as string | undefined;
        if (!keyword) return '错误：缺少 keyword 参数';

        // FTS5 跨 agent 共享，需手动按 agentId 过滤
        const matches = ftsStore.search(keyword, 200);
        let archivedCount = 0;
        const archivedTitles: string[] = [];

        for (const match of matches) {
          const unit = memoryStore.getById(match.memoryId);
          if (!unit || unit.agentId !== agentId || unit.archivedAt) continue;
          memoryStore.archive(match.memoryId);
          archivedCount++;
          if (archivedTitles.length < 5) archivedTitles.push(unit.l0Index);
        }

        if (archivedCount === 0) {
          return `未找到与 "${keyword}" 相关的记忆，归档 0 条`;
        }
        const preview = archivedTitles.length > 0 ? `\n样例：${archivedTitles.join('、')}` : '';
        return `已遗忘 ${archivedCount} 条与 "${keyword}" 相关的记忆${preview}`;
      },
    },
    {
      name: 'memory_pin',
      description:
        '钉选或取消钉选一条记忆。钉选后该记忆免疫热度衰减（不会因为长期未访问而被降权）。' +
        '当用户说"这条很重要，记住别忘 / 把这条置顶" 时调用。pinned=false 时取消钉选。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '记忆 id' },
          pinned: { type: 'boolean', description: '是否钉选（默认 true，传 false 取消钉选）' },
        },
        required: ['id'],
      },
      execute: async (args) => {
        const id = args['id'] as string | undefined;
        const pinned = (args['pinned'] as boolean | undefined) ?? true;

        if (!id) return '错误：缺少 id 参数';

        const existing = memoryStore.getById(id);
        if (!existing) return `未找到 id 为 ${id} 的记忆`;
        if (existing.agentId !== agentId) {
          return '错误：权限不足，无法钉选其他 Agent 的记忆';
        }

        if (pinned) {
          memoryStore.pin(id);
          return `已钉选记忆：${existing.l0Index}`;
        } else {
          memoryStore.unpin(id);
          return `已取消钉选：${existing.l0Index}`;
        }
      },
    },
  );

  return tools;
}
