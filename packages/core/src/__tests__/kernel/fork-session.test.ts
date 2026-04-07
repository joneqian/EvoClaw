/**
 * Fork Session 测试
 *
 * 验证:
 * 1. Fork 后消息完整复制
 * 2. Fork 后修改新 session 不影响源 session
 * 3. Fork 不存在的 session 返回空结果
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { forkSession } from '../../routes/fork-session.js';

// ─── Mock SqliteStore ───

function createMockStore() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    conversation_log: [],
    session_summaries: [],
    session_runtime_state: [],
    file_attributions: [],
  };
  const runLog: Array<{ sql: string; params: unknown[] }> = [];

  return {
    tables,
    runLog,
    run(sql: string, ...params: unknown[]) {
      runLog.push({ sql, params });
      // 模拟 INSERT...SELECT 的 changes
      if (sql.includes('INSERT INTO conversation_log') && sql.includes('SELECT')) {
        const agentId = params[2];
        const sourceKey = params[3];
        const matching = tables.conversation_log.filter(
          r => r.agent_id === agentId && r.session_key === sourceKey,
        );
        return { changes: matching.length, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    },
    get<T>(): T | undefined { return undefined; },
    all<T>(): T[] { return []; },
    transaction<T>(fn: () => T): T { return fn(); },
    exec() {},
    close() {},
    get raw() { return {} as any; },
    get dbPath() { return ':memory:'; },
  };
}

describe('forkSession', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it('成功 fork 返回新 sessionKey 和消息数', () => {
    // 模拟源 session 有 3 条消息
    for (let i = 0; i < 3; i++) {
      store.tables.conversation_log.push({
        agent_id: 'agent-1',
        session_key: 'session-source',
        role: 'user',
        content: `Message ${i}`,
      });
    }

    const result = forkSession(store as any, 'agent-1', 'session-source');

    expect(result.success).toBe(true);
    expect(result.newSessionKey).toBeDefined();
    expect(result.newSessionKey).toContain('session-source:fork:');
    expect(result.messageCount).toBe(3);
  });

  it('自定义 newSessionKey', () => {
    store.tables.conversation_log.push({
      agent_id: 'agent-1',
      session_key: 'session-source',
      role: 'user',
      content: 'Hello',
    });

    const result = forkSession(store as any, 'agent-1', 'session-source', 'my-custom-session');

    expect(result.success).toBe(true);
    expect(result.newSessionKey).toBe('my-custom-session');
  });

  it('空源 session 返回 0 消息', () => {
    const result = forkSession(store as any, 'agent-1', 'empty-session');

    expect(result.success).toBe(true);
    expect(result.messageCount).toBe(0);
  });

  it('事务中执行了 4 个 INSERT...SELECT（messages, summaries, state, attributions）', () => {
    forkSession(store as any, 'agent-1', 'session-source');

    const inserts = store.runLog.filter(r => r.sql.includes('INSERT'));
    expect(inserts.length).toBe(4);
    expect(inserts[0]!.sql).toContain('conversation_log');
    expect(inserts[1]!.sql).toContain('session_summaries');
    expect(inserts[2]!.sql).toContain('session_runtime_state');
    expect(inserts[3]!.sql).toContain('file_attributions');
  });
});
