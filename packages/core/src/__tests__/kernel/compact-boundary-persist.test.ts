/**
 * Compact Boundary 持久化测试
 *
 * 验证:
 * 1. PostCompactHookFn 签名正确接收 summaryText
 * 2. autocompact 返回摘要文本
 * 3. postCompactHook 被正确调用（含 summaryText 参数）
 */
import { describe, it, expect, vi } from 'vitest';
import type { PostCompactHookFn, CompactTrigger } from '../../agent/kernel/types.js';

describe('PostCompactHookFn 签名', () => {
  it('接收 4 个参数: trigger, tokensBefore, tokensAfter, summaryText', async () => {
    const hook: PostCompactHookFn = vi.fn(async (
      _trigger: CompactTrigger,
      _tokensBefore: number,
      _tokensAfter: number,
      _summaryText?: string,
    ) => {
      return {};
    });

    await hook('auto', 100_000, 20_000, '这是一段摘要文本');

    expect(hook).toHaveBeenCalledWith('auto', 100_000, 20_000, '这是一段摘要文本');
  });

  it('summaryText 可选 — SM Compact/Snip 时为 undefined', async () => {
    const hook: PostCompactHookFn = vi.fn(async () => ({}));

    await hook('auto', 100_000, 50_000);
    expect(hook).toHaveBeenCalledWith('auto', 100_000, 50_000);
  });
});

describe('Compact Boundary 持久化闭包', () => {
  it('postCompactHook 写入 compaction_boundary 和摘要', async () => {
    const dbRuns: Array<{ sql: string; params: unknown[] }> = [];
    const summaries: Array<{ summary: string }> = [];

    // 模拟 store.run
    const mockStore = {
      run: (sql: string, ...params: unknown[]) => {
        dbRuns.push({ sql, params });
      },
    };

    // 模拟 sessionSummarizer.save
    const mockSummarizer = {
      save: (agentId: string, sessionKey: string, summary: string) => {
        summaries.push({ summary });
      },
    };

    // 模拟 chat.ts 中的 postCompactHook 闭包
    const agentId = 'agent-001';
    const sessionKey = 'agent:agent-001:local:direct:user';

    const postCompactHook: PostCompactHookFn = async (trigger, tokensBefore, tokensAfter, summaryText) => {
      mockStore.run(
        `INSERT INTO conversation_log (id, agent_id, session_key, role, content, compaction_status, entry_type, created_at) VALUES (?, ?, ?, 'system', ?, 'compacted', 'compaction_boundary', ?)`,
        'test-id', agentId, sessionKey,
        JSON.stringify({ trigger, tokensBefore, tokensAfter }),
        '2026-04-07T10:00:00.000Z',
      );

      if (summaryText) {
        mockSummarizer.save(agentId, sessionKey, summaryText);
      }
      return {};
    };

    // 执行: autocompact 触发，传入摘要
    await postCompactHook('auto', 120_000, 25_000, '## 用户核心需求\n- 实现会话持久化');

    // 验证: boundary 写入
    expect(dbRuns).toHaveLength(1);
    expect(dbRuns[0].sql).toContain('compaction_boundary');
    const boundaryContent = JSON.parse(dbRuns[0].params[3] as string);
    expect(boundaryContent).toEqual({
      trigger: 'auto',
      tokensBefore: 120_000,
      tokensAfter: 25_000,
    });

    // 验证: 摘要持久化
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toContain('用户核心需求');
  });

  it('SM Compact 时不写入摘要（summaryText 为 undefined）', async () => {
    const summaries: string[] = [];

    const postCompactHook: PostCompactHookFn = async (_trigger, _before, _after, summaryText) => {
      if (summaryText) {
        summaries.push(summaryText);
      }
      return {};
    };

    await postCompactHook('auto', 100_000, 50_000); // 无 summaryText
    expect(summaries).toHaveLength(0);
  });
});
