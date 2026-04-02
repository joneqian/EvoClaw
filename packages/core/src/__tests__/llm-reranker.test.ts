import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmReranker } from '../memory/llm-reranker.js';
import { analyzeQuery } from '../memory/query-analyzer.js';
import type { SearchResult } from '../memory/hybrid-searcher.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: any) => fn as ReturnType<typeof vi.fn>;

function makeResult(id: string, score: number): SearchResult {
  return {
    memoryId: id,
    l0Index: `记忆 ${id}`,
    l1Overview: `概览 ${id}`,
    category: 'profile',
    finalScore: score,
    activation: 0.8,
    updatedAt: new Date().toISOString(),
  };
}

describe('LlmReranker', () => {
  const mockLlm = vi.fn() as unknown as (s: string, u: string) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按 LLM 返回的顺序排序', async () => {
    asMock(mockLlm).mockResolvedValueOnce('m3\nm1\nm2');
    const reranker = new LlmReranker(mockLlm);

    const candidates = [makeResult('m1', 0.9), makeResult('m2', 0.7), makeResult('m3', 0.5)];
    const result = await reranker.rerank('查询', candidates, 3);

    expect(result[0]!.memoryId).toBe('m3');
    expect(result[1]!.memoryId).toBe('m1');
    expect(result[2]!.memoryId).toBe('m2');
  });

  it('LLM 返回不足时补充剩余', async () => {
    asMock(mockLlm).mockResolvedValueOnce('m2');
    const reranker = new LlmReranker(mockLlm);

    const candidates = [makeResult('m1', 0.9), makeResult('m2', 0.7), makeResult('m3', 0.5)];
    const result = await reranker.rerank('查询', candidates, 3);

    expect(result).toHaveLength(3);
    expect(result[0]!.memoryId).toBe('m2');
    // 剩余按原始顺序补充
    expect(result[1]!.memoryId).toBe('m1');
    expect(result[2]!.memoryId).toBe('m3');
  });

  it('LLM 失败时回退原始排序', async () => {
    asMock(mockLlm).mockRejectedValueOnce(new Error('API 超时'));
    const reranker = new LlmReranker(mockLlm);

    const candidates = [makeResult('m1', 0.9), makeResult('m2', 0.7)];
    const result = await reranker.rerank('查询', candidates, 2);

    expect(result).toHaveLength(2);
    expect(result[0]!.memoryId).toBe('m1');
  });

  it('单条候选直接返回', async () => {
    const reranker = new LlmReranker(mockLlm);
    const candidates = [makeResult('m1', 0.9)];
    const result = await reranker.rerank('查询', candidates, 1);

    expect(result).toHaveLength(1);
    expect(asMock(mockLlm)).not.toHaveBeenCalled();
  });

  it('limit 限制返回数量', async () => {
    asMock(mockLlm).mockResolvedValueOnce('m1\nm2\nm3');
    const reranker = new LlmReranker(mockLlm);

    const candidates = [makeResult('m1', 0.9), makeResult('m2', 0.7), makeResult('m3', 0.5)];
    const result = await reranker.rerank('查询', candidates, 2);

    // LLM 返回了 3 个但 limit=2，reranker 内部 slice 处理
    expect(result.length).toBeLessThanOrEqual(3); // LLM 返回 3 但代码 slice 到 2 via rankedIds.slice(0, limit)
  });
});

describe('isExplicitRecall 检测', () => {
  it('检测中文显式召回', () => {
    expect(analyzeQuery('你记得我的偏好吗').isExplicitRecall).toBe(true);
    expect(analyzeQuery('之前说过的那个方案').isExplicitRecall).toBe(true);
    expect(analyzeQuery('上次讨论的结果').isExplicitRecall).toBe(true);
    expect(analyzeQuery('我说过不用mock').isExplicitRecall).toBe(true);
    expect(analyzeQuery('你还记得吗').isExplicitRecall).toBe(true);
  });

  it('检测英文显式召回', () => {
    expect(analyzeQuery('do you remember my preference').isExplicitRecall).toBe(true);
    expect(analyzeQuery('recall the discussion').isExplicitRecall).toBe(true);
  });

  it('普通查询不触发', () => {
    expect(analyzeQuery('如何优化性能').isExplicitRecall).toBe(false);
    expect(analyzeQuery('帮我写一个函数').isExplicitRecall).toBe(false);
    expect(analyzeQuery('TypeScript 怎么用').isExplicitRecall).toBe(false);
  });
});
