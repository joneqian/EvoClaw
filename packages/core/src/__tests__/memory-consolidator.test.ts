import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryConsolidator } from '../memory/memory-consolidator.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

// === Mock SqliteStore ===
function createMockDb(overrides: Partial<Record<string, unknown>> = {}): SqliteStore {
  return {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
    transaction: vi.fn((fn: () => void) => fn()),
    ...overrides,
  } as unknown as SqliteStore;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: any) => fn as ReturnType<typeof vi.fn>;

describe('MemoryConsolidator', () => {
  const dataDir = '/tmp/test-evoclaw';
  const mockLlm = vi.fn().mockResolvedValue('<no_consolidation/>') as unknown as (system: string, user: string) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    asMock(mockLlm).mockResolvedValue('<no_consolidation/>');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldRun()', () => {
    it('无整合记录时检查会话数', () => {
      const db = createMockDb({
        get: vi.fn()
          .mockReturnValueOnce(null) // 无 consolidation_log 记录
          .mockReturnValueOnce({ count: 6 }), // 6 个新会话
      });

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = consolidator.shouldRun('agent-1');
      expect(result).toBe(true);
    });

    it('整合间隔不足时跳过', () => {
      const db = createMockDb({
        get: vi.fn().mockReturnValueOnce({
          completed_at: new Date().toISOString(), // 刚刚完成
        }),
      });

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = consolidator.shouldRun('agent-1');
      expect(result).toBe(false);
    });

    it('会话数不足时跳过', () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const db = createMockDb({
        get: vi.fn()
          .mockReturnValueOnce({ completed_at: twoYearsAgo.toISOString() }) // 很久前完成
          .mockReturnValueOnce({ count: 2 }), // 只有 2 个新会话
      });

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = consolidator.shouldRun('agent-1');
      expect(result).toBe(false);
    });
  });

  describe('consolidate()', () => {
    it('记忆不足 5 条时跳过', async () => {
      const db = createMockDb({
        all: vi.fn().mockReturnValue([
          { id: 'm1', agent_id: 'a1', category: 'profile', merge_type: 'merge', merge_key: null, l0_index: 'test', l1_overview: '', l2_content: '', confidence: 1, activation: 1, access_count: 1, visibility: 'private', source_session_key: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), archived_at: null },
        ]),
      });

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = await consolidator.consolidate('agent-1');
      expect(result.status).toBe('skipped');
      expect(mockLlm).not.toHaveBeenCalled();
    });

    it('无重复无低活跃时跳过', async () => {
      const now = new Date().toISOString();
      const makeRow = (id: string, cat: string) => ({
        id, agent_id: 'a1', category: cat, merge_type: 'merge', merge_key: `${cat}:${id}`,
        l0_index: `记忆 ${id}`, l1_overview: '概览', l2_content: '详情',
        confidence: 0.9, activation: 0.8, access_count: 5, visibility: 'private',
        source_session_key: null, created_at: now, updated_at: now, archived_at: null, pinned: 0,
      });

      const db = createMockDb({
        all: vi.fn().mockReturnValue([
          makeRow('m1', 'profile'),
          makeRow('m2', 'preference'),
          makeRow('m3', 'entity'),
          makeRow('m4', 'tool'),
          makeRow('m5', 'skill'),
        ]),
      });

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = await consolidator.consolidate('agent-1');
      expect(result.status).toBe('skipped');
      expect(mockLlm).not.toHaveBeenCalled();
    });

    it('LLM 失败时记录错误', async () => {
      const now = new Date().toISOString();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      const old = oldDate.toISOString();

      const makeRow = (id: string, activation: number, updated: string) => ({
        id, agent_id: 'a1', category: 'profile', merge_type: 'merge', merge_key: `profile:${id}`,
        l0_index: `记忆 ${id}`, l1_overview: '概览', l2_content: '详情',
        confidence: 0.9, activation, access_count: 1, visibility: 'private',
        source_session_key: null, created_at: now, updated_at: updated, archived_at: null, pinned: 0,
      });

      const db = createMockDb({
        all: vi.fn().mockReturnValue([
          makeRow('m1', 0.8, now),
          makeRow('m2', 0.7, now),
          makeRow('m3', 0.05, old), // 低活跃
          makeRow('m4', 0.6, now),
          makeRow('m5', 0.5, now),
        ]),
      });

      asMock(mockLlm).mockRejectedValueOnce(new Error('API 超时'));

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = await consolidator.consolidate('agent-1');
      expect(result.status).toBe('failed');
      expect(result.error).toContain('API 超时');
    });
  });

  describe('parseConsolidationXml()', () => {
    it('解析 merge 和 archive 指令', async () => {
      const xml = `<consolidation>
  <merge source_id="m2" target_id="m1">
    <l1_overview>合并后的概览</l1_overview>
    <l2_content>合并后的详情</l2_content>
  </merge>
  <archive id="m3" reason="30天未访问且活跃度极低" />
</consolidation>`;

      const now = new Date().toISOString();
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      const old = oldDate.toISOString();

      const makeRow = (id: string, activation: number, updated: string, mergeKey: string) => ({
        id, agent_id: 'a1', category: 'profile', merge_type: 'merge', merge_key: mergeKey,
        l0_index: `记忆 ${id}`, l1_overview: '旧概览', l2_content: '旧详情',
        confidence: 0.9, activation, access_count: 1, visibility: 'private',
        source_session_key: null, created_at: now, updated_at: updated, archived_at: null, pinned: 0,
      });

      // 修改 get 实现: 返回对应的记忆对象用于 merge
      const allRows = [
        makeRow('m1', 0.8, now, 'profile:name'),
        makeRow('m2', 0.7, now, 'profile:name'), // 与 m1 同 mergeKey → 重复
        makeRow('m3', 0.05, old, 'profile:job'),  // 低活跃
        makeRow('m4', 0.6, now, 'profile:loc'),
        makeRow('m5', 0.5, now, 'profile:lang'),
      ];

      const db = createMockDb({
        all: vi.fn().mockReturnValue(allRows),
        get: vi.fn().mockImplementation((...args: unknown[]) => {
          const query = args[0] as string;
          if (query.includes('consolidation_log')) return null;
          // getById
          const id = args[1] as string;
          const row = allRows.find(r => r.id === id);
          return row ?? null;
        }),
      });

      asMock(mockLlm).mockResolvedValueOnce(xml);

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = await consolidator.consolidate('agent-1');

      expect(result.status).toBe('completed');
      expect(result.merged).toBe(1);
      expect(result.pruned).toBe(1);
    });

    it('no_consolidation 时不执行操作', async () => {
      const now = new Date().toISOString();
      const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

      const makeRow = (id: string, activation: number) => ({
        id, agent_id: 'a1', category: 'profile', merge_type: 'merge', merge_key: `profile:${id}`,
        l0_index: `记忆 ${id}`, l1_overview: '概览', l2_content: '详情',
        confidence: 0.9, activation, access_count: 1, visibility: 'private',
        source_session_key: null, created_at: now, updated_at: old, archived_at: null, pinned: 0,
      });

      const db = createMockDb({
        all: vi.fn().mockReturnValue([
          makeRow('m1', 0.05),
          makeRow('m2', 0.05),
          makeRow('m3', 0.05),
          makeRow('m4', 0.05),
          makeRow('m5', 0.05),
        ]),
      });

      asMock(mockLlm).mockResolvedValueOnce('<no_consolidation/>');

      const consolidator = new MemoryConsolidator(db, mockLlm, dataDir);
      const result = await consolidator.consolidate('agent-1');
      expect(result.status).toBe('completed');
      expect(result.merged).toBe(0);
      expect(result.pruned).toBe(0);
    });
  });
});
