import type { MemoryUnit } from '@evoclaw/shared';
import { HOTNESS_HALF_LIFE_DAYS, MEMORY_L2_BUDGET_TOKENS } from '@evoclaw/shared';

import type { FtsStore } from '../infrastructure/db/fts-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import type { KnowledgeGraphStore } from './knowledge-graph.js';
import type { MemoryStore } from './memory-store.js';
import { analyzeQuery, type QueryType } from './query-analyzer.js';

/** 搜索结果 */
export interface SearchResult {
  memoryId: string;
  l0Index: string;
  l1Overview: string;
  l2Content?: string;  // 仅在 Phase 3 按需加载
  category: string;
  finalScore: number;
  activation: number;
}

/** 搜索选项 */
export interface SearchOptions {
  limit?: number;          // 默认 10
  candidateLimit?: number; // Phase 1 候选数量，默认 30
  loadL2?: boolean;        // 强制加载 L2
  visibility?: 'private' | 'shared' | 'channel_only';
}

export class HybridSearcher {
  constructor(
    private ftsStore: FtsStore,
    private vectorStore: VectorStore,
    private knowledgeGraph: KnowledgeGraphStore,
    private memoryStore: MemoryStore,
  ) {}

  /**
   * 三阶段渐进检索
   * Phase 1: 候选生成 (FTS5 + 向量 + 知识图谱)
   * Phase 2: 评分排序 (searchScore x hotness x categoryBoost)
   * Phase 3: L2 按需加载 (Token 预算 <= 8K)
   */
  async hybridSearch(query: string, agentId: string, options?: SearchOptions): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;
    const candidateLimit = options?.candidateLimit ?? 30;
    const analysis = analyzeQuery(query);

    // === Phase 1: 候选生成 ===
    const candidateScores = new Map<string, number>();

    // 1a: FTS5 关键词搜索（权重 0.3）
    const ftsQuery = analysis.keywords.join(' ');
    if (ftsQuery) {
      const ftsResults = this.ftsStore.search(ftsQuery, candidateLimit);
      for (const r of ftsResults) {
        const normalized = Math.min(1, Math.abs(r.score) / 20); // 归一化 BM25 分数
        candidateScores.set(r.memoryId, (candidateScores.get(r.memoryId) ?? 0) + normalized * 0.3);
      }
    }

    // 1b: 向量搜索（权重 0.5）— 需要 embeddingFn
    // 暂时跳过，后续接入 embedding API 后启用

    // 1c: 知识图谱关系扩展（权重 0.2）
    if (analysis.keywords.length > 0) {
      const kgResults = this.knowledgeGraph.expandEntities(analysis.keywords);
      for (const entry of kgResults) {
        // 将关联的 subject/object 作为候选
        candidateScores.set(entry.subjectId, (candidateScores.get(entry.subjectId) ?? 0) + 0.2 * entry.confidence);
        candidateScores.set(entry.objectId, (candidateScores.get(entry.objectId) ?? 0) + 0.2 * entry.confidence);
      }
    }

    if (candidateScores.size === 0) return [];

    // 取 Top-N 候选 ID
    const candidateIds = [...candidateScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, candidateLimit)
      .map(([id]) => id);

    // === Phase 2: 评分排序 ===
    const units = this.memoryStore.getByIds(candidateIds);
    // 按 agent 和可见性过滤
    const filtered = units.filter(u => {
      if (u.agentId !== agentId) return false;
      if (u.archivedAt) return false;
      if (options?.visibility && u.visibility !== options.visibility) return false;
      return true;
    });

    const scored: SearchResult[] = filtered.map(unit => {
      const searchScore = candidateScores.get(unit.id) ?? 0;
      const hotness = computeHotness(unit);
      const categoryBoost = getCategoryBoost(unit.category, analysis.queryType);
      const correctionBoost = unit.category === 'correction' ? 1.5 : 1.0;
      const finalScore = searchScore * hotness * categoryBoost * correctionBoost;

      return {
        memoryId: unit.id,
        l0Index: unit.l0Index,
        l1Overview: unit.l1Overview,
        category: unit.category,
        finalScore,
        activation: unit.activation,
      };
    });

    // 去重：同 merge_key 只保留最高分
    const mergeKeyMap = new Map<string, SearchResult>();
    const nonMerge: SearchResult[] = [];
    for (const r of scored) {
      const unit = filtered.find(u => u.id === r.memoryId);
      if (unit?.mergeKey) {
        const existing = mergeKeyMap.get(unit.mergeKey);
        if (!existing || r.finalScore > existing.finalScore) {
          mergeKeyMap.set(unit.mergeKey, r);
        }
      } else {
        nonMerge.push(r);
      }
    }
    const deduped = [...mergeKeyMap.values(), ...nonMerge];

    // 排序取 Top-N
    deduped.sort((a, b) => b.finalScore - a.finalScore);
    const topResults = deduped.slice(0, limit);

    // 提升被召回记忆的 activation
    const recalledIds = topResults.map(r => r.memoryId);
    if (recalledIds.length > 0) {
      this.memoryStore.bumpActivation(recalledIds);
    }

    // === Phase 3: L2 按需加载 ===
    if (options?.loadL2 || analysis.needsDetail) {
      let tokenBudget = MEMORY_L2_BUDGET_TOKENS;
      for (const result of topResults) {
        const unit = this.memoryStore.getById(result.memoryId);
        if (unit) {
          const estimatedTokens = Math.ceil(unit.l2Content.length / 4);
          if (estimatedTokens <= tokenBudget) {
            result.l2Content = unit.l2Content;
            tokenBudget -= estimatedTokens;
          }
        }
        if (tokenBudget <= 0) break;
      }
    }

    return topResults;
  }
}

/** 计算 hotness 分数 */
function computeHotness(unit: { accessCount: number; updatedAt: string }): number {
  const ageDays = (Date.now() - new Date(unit.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  const decayRate = Math.LN2 / HOTNESS_HALF_LIFE_DAYS;
  const accessFactor = sigmoid(Math.log1p(unit.accessCount));
  const timeFactor = Math.exp(-decayRate * ageDays);
  return accessFactor * timeFactor;
}

/** Sigmoid 函数 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** 查询类型 x 类别的加分矩阵 */
function getCategoryBoost(category: string, queryType: QueryType): number {
  const matrix: Record<QueryType, Record<string, number>> = {
    factual:    { profile: 1.5, entity: 1.5, preference: 1.0, event: 0.8, case: 0.8, pattern: 0.8, tool: 0.8, skill: 0.8, correction: 1.2 },
    preference: { profile: 1.0, entity: 0.8, preference: 1.5, event: 0.8, case: 0.8, pattern: 1.2, tool: 0.8, skill: 0.8, correction: 1.3 },
    temporal:   { profile: 0.8, entity: 0.8, preference: 0.8, event: 1.5, case: 1.2, pattern: 0.8, tool: 0.8, skill: 0.8, correction: 1.0 },
    skill:      { profile: 0.8, entity: 0.8, preference: 0.8, event: 0.8, case: 1.3, pattern: 1.0, tool: 1.5, skill: 1.5, correction: 1.2 },
    general:    { profile: 1.0, entity: 1.0, preference: 1.0, event: 1.0, case: 1.0, pattern: 1.0, tool: 1.0, skill: 1.0, correction: 1.0 },
  };
  return matrix[queryType]?.[category] ?? 1.0;
}
