/**
 * LLM 相关性精选层 — 用 LLM 对混合搜索结果做最终排序
 *
 * 仅在高价值场景触发（显式召回、需要详情时），
 * 补齐向量搜索在深度推理场景的不足。
 */

import type { LLMCallFn } from './memory-extractor.js';
import { createLogger } from '../infrastructure/logger.js';

/** 可排序的记忆候选（避免循环依赖 hybrid-searcher ↔ llm-reranker） */
export interface RerankCandidate {
  memoryId: string;
  l0Index: string;
  l1Overview: string;
  category: string;
}

const log = createLogger('llm-reranker');

export class LlmReranker {
  constructor(private llmCall: LLMCallFn) {}

  /**
   * 用 LLM 从 candidates 中选择最相关的 Top-N
   * @param query 用户查询
   * @param candidates 混合搜索的候选结果
   * @param limit 返回数量
   */
  async rerank<T extends RerankCandidate>(query: string, candidates: T[], limit: number): Promise<T[]> {
    if (candidates.length <= 1) return candidates;

    const system = `你是一个记忆相关性评估引擎。给定用户查询和候选记忆列表，按相关性从高到低排序。

## 输出格式
只输出排序后的记忆 ID 列表，每行一个 ID，最相关的排在最前面。不要输出其他内容。

示例输出：
m-abc123
m-def456
m-ghi789`;

    const candidateList = candidates.map((c, i) =>
      `[${i + 1}] ID=${c.memoryId}\n  类别: ${c.category}\n  摘要: ${c.l0Index}\n  概览: ${c.l1Overview.slice(0, 200)}`
    ).join('\n\n');

    const user = `用户查询: "${query}"

候选记忆:
${candidateList}

请按与用户查询的相关性从高到低排序，输出 ID 列表（最多 ${limit} 个）:`;

    try {
      const startTime = Date.now();
      const response = await this.llmCall(system, user);
      const elapsed = Date.now() - startTime;

      // 解析 LLM 返回的 ID 列表
      const rankedIds = response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .slice(0, limit);

      // 按 LLM 排序重组
      const idToCandidate = new Map(candidates.map(c => [c.memoryId, c]));
      const reranked: T[] = [];
      for (const id of rankedIds) {
        const candidate = idToCandidate.get(id);
        if (candidate) {
          reranked.push(candidate);
          idToCandidate.delete(id);
        }
      }

      // 如果 LLM 返回的 ID 不足 limit，补充未排序的剩余结果
      if (reranked.length < limit) {
        const remaining = candidates.filter(c => !reranked.some(r => r.memoryId === c.memoryId));
        reranked.push(...remaining.slice(0, limit - reranked.length));
      }

      log.info(`LLM 精选完成: ${candidates.length} → ${reranked.length} 条 (${elapsed}ms)`);
      return reranked;
    } catch (err) {
      log.error(`LLM 精选失败: ${err instanceof Error ? err.message : String(err)}，回退原始排序`);
      return candidates.slice(0, limit);
    }
  }
}
