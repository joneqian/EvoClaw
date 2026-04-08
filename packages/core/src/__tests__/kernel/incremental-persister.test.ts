/**
 * IncrementalPersister 测试
 *
 * 验证:
 * 1. persistTurn 正确写入 SQLite
 * 2. flush 清空内存缓冲
 * 3. finalize 将 streaming → final
 * 4. loadOrphaned 恢复崩溃残留消息
 * 5. 批量写入合并为单事务
 * 6. dispose 后不再接受新消息
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncrementalPersister } from '../../agent/kernel/incremental-persister.js';
import type { KernelMessage } from '../../agent/kernel/types.js';

// ─── Mock SqliteStore ───

interface MockRow {
  id: string;
  agent_id: string;
  session_key: string;
  role: string;
  content: string;
  turn_index: number;
  kernel_message_json: string;
  persist_status: string;
}

function createMockStore() {
  const rows: MockRow[] = [];
  const updateLog: Array<{ sql: string; params: unknown[] }> = [];

  return {
    rows,
    updateLog,
    run(sql: string, ...params: unknown[]) {
      updateLog.push({ sql, params });

      if (sql.includes('INSERT OR IGNORE')) {
        rows.push({
          id: params[0] as string,
          agent_id: params[1] as string,
          session_key: params[2] as string,
          role: params[3] as string,
          content: params[4] as string,
          turn_index: params[5] as number,
          kernel_message_json: params[6] as string,
          persist_status: 'streaming',
        });
        return { changes: 1, lastInsertRowid: rows.length };
      }

      // UPDATE streaming → orphaned
      if (sql.includes("persist_status = 'orphaned'") && sql.includes("persist_status = 'streaming'")) {
        for (const row of rows) {
          if (row.agent_id === params[0] && row.session_key === params[1] && row.persist_status === 'streaming') {
            row.persist_status = 'orphaned';
          }
        }
        return { changes: 0, lastInsertRowid: 0 };
      }

      // UPDATE orphaned → final
      if (sql.includes("persist_status = 'final'") && sql.includes("persist_status = 'orphaned'")) {
        for (const row of rows) {
          if (row.agent_id === params[0] && row.session_key === params[1] && row.persist_status === 'orphaned') {
            row.persist_status = 'final';
          }
        }
        return { changes: 0, lastInsertRowid: 0 };
      }

      // UPDATE streaming → final (finalize)
      if (sql.includes("persist_status = 'final'") && sql.includes("persist_status = 'streaming'")) {
        for (const row of rows) {
          if (row.agent_id === params[0] && row.session_key === params[1] && row.persist_status === 'streaming') {
            row.persist_status = 'final';
          }
        }
        return { changes: 0, lastInsertRowid: 0 };
      }

      return { changes: 0, lastInsertRowid: 0 };
    },
    get<T>(_sql: string, ..._params: unknown[]): T | undefined {
      return undefined;
    },
    all<T>(sql: string, ...params: unknown[]): T[] {
      if (sql.includes("persist_status = 'orphaned'")) {
        return rows
          .filter(r => r.agent_id === params[0] && r.session_key === params[1] && r.persist_status === 'orphaned')
          .map(r => ({ kernel_message_json: r.kernel_message_json, turn_index: r.turn_index })) as T[];
      }
      return [];
    },
    transaction<T>(fn: () => T): T {
      return fn();
    },
    exec(_sql: string) {},
    close() {},
    get raw() { return {} as any; },
    get dbPath() { return ':memory:'; },
  };
}

// ─── Test Helpers ───

function makeAssistantMsg(text: string): KernelMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: [{ type: 'text', text }],
  };
}

function makeToolResultMsg(toolUseId: string, content: string): KernelMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
  };
}

// ─── Tests ───

describe('IncrementalPersister', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    vi.useFakeTimers();
  });

  it('persistTurn + flush 写入 SQLite', () => {
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');
    const msg = makeAssistantMsg('Hello world');

    persister.persistTurn(0, [msg]);

    // 尚未写入（在 100ms timer 中）
    expect(store.rows.length).toBe(0);

    // flush 强制写入
    persister.flush();
    expect(store.rows.length).toBe(1);
    expect(store.rows[0]!.role).toBe('assistant');
    expect(store.rows[0]!.content).toBe('Hello world');
    expect(store.rows[0]!.turn_index).toBe(0);
    expect(store.rows[0]!.persist_status).toBe('streaming');

    // 反序列化验证
    const parsed = JSON.parse(store.rows[0]!.kernel_message_json);
    expect(parsed.id).toBe(msg.id);
    expect(parsed.content[0].text).toBe('Hello world');

    persister.dispose();
  });

  it('100ms 定时器自动 drain', () => {
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');

    persister.persistTurn(0, [makeAssistantMsg('Auto drain')]);
    expect(store.rows.length).toBe(0);

    // 推进 100ms
    vi.advanceTimersByTime(100);
    expect(store.rows.length).toBe(1);
    expect(store.rows[0]!.content).toBe('Auto drain');

    persister.dispose();
  });

  it('批量合并多条消息为单事务', () => {
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');
    const transactionSpy = vi.spyOn(store, 'transaction');

    // 同一 tick 内多次 persistTurn
    persister.persistTurn(0, [makeAssistantMsg('Msg 1')]);
    persister.persistTurn(0, [makeToolResultMsg('tu-1', 'Result 1')]);
    persister.persistTurn(1, [makeAssistantMsg('Msg 2')]);

    persister.flush();

    // 应该只调用一次 transaction
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(store.rows.length).toBe(3);

    persister.dispose();
  });

  it('finalize 将 streaming → final', () => {
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');

    persister.persistTurn(0, [makeAssistantMsg('Turn 0')]);
    persister.persistTurn(1, [makeAssistantMsg('Turn 1')]);
    persister.flush();

    expect(store.rows.every(r => r.persist_status === 'streaming')).toBe(true);

    persister.finalize();

    expect(store.rows.every(r => r.persist_status === 'final')).toBe(true);

    persister.dispose();
  });

  it('dispose 后不再接受新消息', () => {
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');

    persister.dispose();
    persister.persistTurn(0, [makeAssistantMsg('Should be ignored')]);
    persister.flush();

    expect(store.rows.length).toBe(0);
  });

  it('tool_result 消息的 content 使用工具结果摘要（非占位符）', () => {
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');

    persister.persistTurn(0, [makeToolResultMsg('tu-1', 'File content here')]);
    persister.flush();

    // tool_result 没有 text block，content 应为可读摘要而非 [xxx message with N blocks] 占位符
    expect(store.rows[0]!.content).toBe('[工具结果] File content here');
    expect(store.rows[0]!.content).not.toMatch(/\[\w+ message with \d+ blocks\]/);

    persister.dispose();
  });

  it('created_at 使用 ISO 格式（与 saveMessage 一致）', () => {
    // 需要禁用 fake timers 才能拿到真实的 ISO 时间戳
    vi.useRealTimers();
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');

    persister.persistTurn(0, [makeAssistantMsg('test')]);
    persister.flush();

    // INSERT 调用的最后一个参数是 createdAt（绑定到第 8 个参数 'streaming' 之后）
    const insertLog = store.updateLog.find(l => l.sql.includes('INSERT OR IGNORE'));
    expect(insertLog).toBeDefined();
    const createdAt = insertLog!.params[insertLog!.params.length - 1] as string;
    // 应为 ISO 8601 格式（YYYY-MM-DDTHH:MM:SS.mmmZ）
    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 不应为 SQLite datetime('now') 的空格分隔格式
    expect(createdAt).not.toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    persister.dispose();
  });

  it('多轮消息按字符串排序结果与时间顺序一致（Mock 非 fake timers）', async () => {
    // 验证：两次 persistTurn 的时间戳字符串排序后顺序与插入顺序一致
    vi.useRealTimers();
    const persister = new IncrementalPersister(store as any, 'agent-1', 'session-1');

    persister.persistTurn(0, [makeAssistantMsg('first')]);
    await new Promise(r => setTimeout(r, 5));
    persister.persistTurn(1, [makeAssistantMsg('second')]);
    persister.flush();

    const createdAts = store.rows.map(r => {
      // 从 updateLog 找到对应 row 的 created_at
      const entry = store.updateLog.find(
        l => l.sql.includes('INSERT OR IGNORE') && l.params[0] === r.id,
      );
      return entry!.params[entry!.params.length - 1] as string;
    });
    const sorted = [...createdAts].sort();
    expect(sorted).toEqual(createdAts);

    persister.dispose();
  });
});

describe('IncrementalPersister.loadOrphaned', () => {
  it('恢复崩溃残留的 streaming 消息', () => {
    const store = createMockStore();
    const agentId = 'agent-1';
    const sessionKey = 'session-1';

    // 模拟崩溃残留: 直接插入 streaming 状态的行
    const msg = makeAssistantMsg('Orphaned message');
    store.rows.push({
      id: 'orphan-1',
      agent_id: agentId,
      session_key: sessionKey,
      role: 'assistant',
      content: 'Orphaned message',
      turn_index: 0,
      kernel_message_json: JSON.stringify(msg),
      persist_status: 'streaming',
    });

    const recovered = IncrementalPersister.loadOrphaned(store as any, agentId, sessionKey);

    expect(recovered.length).toBe(1);
    expect(recovered[0]!.id).toBe(msg.id);
    expect((recovered[0]!.content[0] as any).text).toBe('Orphaned message');

    // 恢复后状态应为 final
    expect(store.rows[0]!.persist_status).toBe('final');
  });

  it('无残留消息时返回空数组', () => {
    const store = createMockStore();

    const recovered = IncrementalPersister.loadOrphaned(store as any, 'agent-1', 'session-1');
    expect(recovered).toEqual([]);
  });

  it('JSON 解析失败的消息被跳过', () => {
    const store = createMockStore();

    store.rows.push({
      id: 'orphan-bad',
      agent_id: 'agent-1',
      session_key: 'session-1',
      role: 'assistant',
      content: 'Bad',
      turn_index: 0,
      kernel_message_json: '{invalid json',
      persist_status: 'streaming',
    });

    // all() mock 需要支持这个 case
    const origAll = store.all.bind(store);
    store.all = <T>(sql: string, ...params: unknown[]): T[] => {
      if (sql.includes("persist_status = 'orphaned'")) {
        return [{ kernel_message_json: '{invalid json', turn_index: 0 }] as T[];
      }
      return origAll(sql, ...params);
    };

    const recovered = IncrementalPersister.loadOrphaned(store as any, 'agent-1', 'session-1');
    expect(recovered).toEqual([]);
  });
});
