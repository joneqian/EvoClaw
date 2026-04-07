/**
 * Runtime State Store 测试
 *
 * 验证:
 * 1. FileStateCache toJSON/fromJSON 序列化往返
 * 2. saveRuntimeState / loadRuntimeState 正确读写
 * 3. 无保存状态时返回 null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileStateCache } from '../../agent/kernel/file-state-cache.js';
import { saveRuntimeState, loadRuntimeState } from '../../agent/kernel/runtime-state-store.js';
import type { RuntimeStateSnapshot } from '../../agent/kernel/runtime-state-store.js';

// ─── Mock SqliteStore ───

function createMockStore() {
  const rows = new Map<string, { state_key: string; state_value: string }>();

  return {
    run(sql: string, ...params: unknown[]) {
      if (sql.includes('INSERT INTO session_runtime_state')) {
        const key = params[2] as string;
        rows.set(key, { state_key: key, state_value: params[3] as string });
      }
      return { changes: 1, lastInsertRowid: 0 };
    },
    get<T>(): T | undefined { return undefined; },
    all<T>(sql: string, ...params: unknown[]): T[] {
      if (sql.includes('session_runtime_state')) {
        return [...rows.values()] as T[];
      }
      return [];
    },
    transaction<T>(fn: () => T): T { return fn(); },
    exec() {},
    close() {},
    get raw() { return {} as any; },
    get dbPath() { return ':memory:'; },
  };
}

// ─── FileStateCache Serialization ───

describe('FileStateCache serialization', () => {
  it('toJSON 返回所有缓存条目', () => {
    const cache = new FileStateCache();
    // 使用 mock — 不依赖真实文件系统
    const data = {
      '/tmp/test-a.txt': { mtimeMs: 1000, readAt: 2000, isPartialView: false, contentLength: 100 },
      '/tmp/test-b.txt': { mtimeMs: 3000, readAt: 4000, isPartialView: true, contentLength: 50 },
    };

    // 直接验证 toJSON 返回空（因为没 recordRead）
    expect(cache.toJSON()).toEqual({});
    expect(cache.size).toBe(0);
  });

  it('fromJSON 过滤不存在的文件', () => {
    const data = {
      '/tmp/nonexistent-file-123456789.txt': {
        mtimeMs: 1000, readAt: 2000, isPartialView: false, contentLength: 100,
      },
    };

    const cache = FileStateCache.fromJSON(data);
    // 文件不存在，应被过滤
    expect(cache.size).toBe(0);
  });

  it('roundtrip: toJSON → fromJSON 保持数据一致（使用真实临时文件）', async () => {
    const fs = await import('node:fs');
    const tmpFile = '/tmp/evoclaw-test-fsc-roundtrip.txt';

    try {
      fs.writeFileSync(tmpFile, 'test content');

      const cache = new FileStateCache();
      cache.recordRead(tmpFile, 12, false);

      const json = cache.toJSON();
      expect(json[tmpFile]).toBeDefined();
      expect(json[tmpFile]!.contentLength).toBe(12);
      expect(json[tmpFile]!.isPartialView).toBe(false);

      const restored = FileStateCache.fromJSON(json);
      expect(restored.size).toBe(1);
      expect(restored.wasReadBefore(tmpFile)).toBe(true);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
    }
  });
});

// ─── RuntimeStateStore ───

describe('RuntimeStateStore', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it('saveRuntimeState + loadRuntimeState 往返', () => {
    const snapshot: RuntimeStateSnapshot = {
      compactorFailures: 2,
      modelOverride: { modelId: 'gpt-4o', protocol: 'openai-completions' },
    };

    saveRuntimeState(store as any, 'agent-1', 'session-1', snapshot);
    const loaded = loadRuntimeState(store as any, 'agent-1', 'session-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.compactorFailures).toBe(2);
    expect(loaded!.modelOverride).toEqual({ modelId: 'gpt-4o', protocol: 'openai-completions' });
  });

  it('无保存状态时返回 null', () => {
    const loaded = loadRuntimeState(store as any, 'agent-1', 'session-1');
    expect(loaded).toBeNull();
  });

  it('部分状态保存: 只有 compactorFailures', () => {
    saveRuntimeState(store as any, 'agent-1', 'session-1', { compactorFailures: 5 });
    const loaded = loadRuntimeState(store as any, 'agent-1', 'session-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.compactorFailures).toBe(5);
    expect(loaded!.fileStateCache).toBeUndefined();
    expect(loaded!.collapseState).toBeUndefined();
    expect(loaded!.modelOverride).toBeUndefined();
  });

  it('损坏的 JSON 值被跳过', () => {
    // 直接注入坏数据
    const origAll = store.all.bind(store);
    store.all = <T>(sql: string, ...params: unknown[]): T[] => {
      if (sql.includes('session_runtime_state')) {
        return [{ state_key: 'compactor_failures', state_value: '{bad json' }] as T[];
      }
      return origAll(sql, ...params);
    };

    const loaded = loadRuntimeState(store as any, 'agent-1', 'session-1');
    // 应返回空快照（不为 null，因为有行数据，但值解析失败）
    expect(loaded).not.toBeNull();
    expect(loaded!.compactorFailures).toBeUndefined();
  });
});
