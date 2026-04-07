/**
 * FileAttributionTracker 测试
 *
 * 验证:
 * 1. record + flush 正确写入
 * 2. getModifiedFiles 去重 + 仅返回写操作
 * 3. 批量写入 (每 10 条自动 flush)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FileAttributionTracker } from '../../agent/kernel/file-attribution-tracker.js';

// ─── Mock SqliteStore ───

function createMockStore() {
  const rows: Array<Record<string, unknown>> = [];

  return {
    rows,
    run(sql: string, ...params: unknown[]) {
      if (sql.includes('INSERT INTO file_attributions')) {
        rows.push({
          id: params[0],
          agent_id: params[1],
          session_key: params[2],
          file_path: params[3],
          action: params[4],
          content_hash: params[5],
          turn_index: params[6],
        });
      }
      return { changes: 1, lastInsertRowid: 0 };
    },
    get<T>(): T | undefined { return undefined; },
    all<T>(sql: string, ...params: unknown[]): T[] {
      if (sql.includes('file_attributions') && sql.includes('DISTINCT')) {
        // getModifiedFiles mock
        const agentId = params[0];
        const sessionKey = params[1];
        const writes = rows
          .filter(r => r.agent_id === agentId && r.session_key === sessionKey
            && ['write', 'edit', 'create'].includes(r.action as string))
          .map(r => r.file_path);
        const unique = [...new Set(writes)];
        return unique.map(fp => ({ file_path: fp })) as T[];
      }
      if (sql.includes('file_attributions')) {
        const agentId = params[0];
        const sessionKey = params[1];
        return rows
          .filter(r => r.agent_id === agentId && r.session_key === sessionKey)
          .map(r => ({
            file_path: r.file_path, action: r.action,
            turn_index: r.turn_index, created_at: '2026-01-01',
          })) as T[];
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

describe('FileAttributionTracker', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it('record + flush 写入 SQLite', () => {
    const tracker = new FileAttributionTracker(store as any, 'agent-1', 'session-1');

    tracker.record('/tmp/file.ts', 'write', 0);
    tracker.record('/tmp/file2.ts', 'read', 1);
    tracker.flush();

    expect(store.rows.length).toBe(2);
    expect(store.rows[0]!.file_path).toBe('/tmp/file.ts');
    expect(store.rows[0]!.action).toBe('write');
    expect(store.rows[1]!.file_path).toBe('/tmp/file2.ts');
    expect(store.rows[1]!.action).toBe('read');
  });

  it('getModifiedFiles 仅返回 write/edit/create', () => {
    const tracker = new FileAttributionTracker(store as any, 'agent-1', 'session-1');

    tracker.record('/tmp/read-only.ts', 'read', 0);
    tracker.record('/tmp/written.ts', 'write', 1);
    tracker.record('/tmp/edited.ts', 'edit', 2);
    tracker.record('/tmp/created.ts', 'create', 3);
    tracker.flush();

    const modified = FileAttributionTracker.getModifiedFiles(store as any, 'agent-1', 'session-1');

    expect(modified).toContain('/tmp/written.ts');
    expect(modified).toContain('/tmp/edited.ts');
    expect(modified).toContain('/tmp/created.ts');
    expect(modified).not.toContain('/tmp/read-only.ts');
  });

  it('自动 flush 在第 10 条时触发', () => {
    const tracker = new FileAttributionTracker(store as any, 'agent-1', 'session-1');

    for (let i = 0; i < 10; i++) {
      tracker.record(`/tmp/file-${i}.ts`, 'read', i);
    }

    // 第 10 条应触发自动 flush
    expect(store.rows.length).toBe(10);
  });

  it('getAllOperations 返回全部操作', () => {
    const tracker = new FileAttributionTracker(store as any, 'agent-1', 'session-1');

    tracker.record('/tmp/a.ts', 'read', 0);
    tracker.record('/tmp/a.ts', 'edit', 1);
    tracker.flush();

    const ops = FileAttributionTracker.getAllOperations(store as any, 'agent-1', 'session-1');
    expect(ops.length).toBe(2);
    expect(ops[0]!.action).toBe('read');
    expect(ops[1]!.action).toBe('edit');
  });
});
