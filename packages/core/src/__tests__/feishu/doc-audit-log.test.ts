/**
 * DocEditAuditLog 单测（M13 Phase 5 C4）
 *
 * 用 in-memory SqliteStore 验证 record + listRecent；migration 应用通过 exec()
 * 直接跑 schema SQL（不走 MigrationRunner，避免拖到所有 migrations）。
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { DocEditAuditLog } from '../../channel/adapters/feishu/doc/audit-log.js';

const SCHEMA = `
CREATE TABLE doc_edit_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  agent_id TEXT,
  account_id TEXT NOT NULL,
  file_token TEXT NOT NULL,
  block_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('replace', 'delete', 'append')),
  before_text TEXT,
  after_text TEXT,
  document_revision_id INTEGER
);
CREATE INDEX idx_doc_edit_audit_file_token_ts ON doc_edit_audit(file_token, ts DESC);
`;

function makeStore(): SqliteStore {
  const store = new SqliteStore(':memory:');
  store.exec(SCHEMA);
  return store;
}

describe('DocEditAuditLog', () => {
  let store: SqliteStore;
  let log: DocEditAuditLog;

  beforeEach(() => {
    store = makeStore();
    log = new DocEditAuditLog(store);
  });

  it('record + listRecent：roundtrip 完整字段', () => {
    log.record({
      ts: 1700000000000,
      agentId: 'agent_a',
      accountId: 'cli_x',
      fileToken: 'doc_tok_a',
      blockId: 'b1',
      action: 'replace',
      beforeText: '原文',
      afterText: '新文',
      documentRevisionId: 42,
    });

    const recent = log.listRecent('doc_tok_a');
    expect(recent).toHaveLength(1);
    expect(recent[0]).toEqual({
      ts: 1700000000000,
      agentId: 'agent_a',
      accountId: 'cli_x',
      fileToken: 'doc_tok_a',
      blockId: 'b1',
      action: 'replace',
      beforeText: '原文',
      afterText: '新文',
      documentRevisionId: 42,
    });
  });

  it('listRecent 按 ts 倒序', () => {
    log.record({ ts: 100, accountId: 'cli', fileToken: 'tok', blockId: 'b1', action: 'append' });
    log.record({ ts: 200, accountId: 'cli', fileToken: 'tok', blockId: 'b2', action: 'replace' });
    log.record({ ts: 50, accountId: 'cli', fileToken: 'tok', blockId: 'b3', action: 'delete' });

    const recent = log.listRecent('tok');
    expect(recent.map((r) => r.ts)).toEqual([200, 100, 50]);
  });

  it('listRecent 按 file_token 隔离', () => {
    log.record({ ts: 1, accountId: 'cli', fileToken: 'tokA', blockId: 'b', action: 'append' });
    log.record({ ts: 2, accountId: 'cli', fileToken: 'tokB', blockId: 'b', action: 'append' });

    expect(log.listRecent('tokA')).toHaveLength(1);
    expect(log.listRecent('tokB')).toHaveLength(1);
    expect(log.listRecent('tokC')).toHaveLength(0);
  });

  it('listRecent limit 截断', () => {
    for (let i = 0; i < 25; i += 1) {
      log.record({ ts: i, accountId: 'cli', fileToken: 'tok', blockId: `b${i}`, action: 'append' });
    }
    expect(log.listRecent('tok', 10)).toHaveLength(10);
    expect(log.listRecent('tok', 30)).toHaveLength(25);
    expect(log.listRecent('tok')).toHaveLength(20); // 默认 20
  });

  it('append/delete 时 beforeText/afterText 可选 null', () => {
    log.record({
      ts: 1,
      accountId: 'cli',
      fileToken: 'tok',
      blockId: 'b',
      action: 'append',
      afterText: 'new',
    });
    log.record({
      ts: 2,
      accountId: 'cli',
      fileToken: 'tok',
      blockId: 'b2',
      action: 'delete',
      beforeText: 'old',
    });

    const recent = log.listRecent('tok');
    expect(recent[1]!.afterText).toBe('new');
    expect(recent[1]!.beforeText).toBeNull();
    expect(recent[0]!.beforeText).toBe('old');
    expect(recent[0]!.afterText).toBeNull();
  });

  it('action CHECK 拒绝非法值（schema 守护）', () => {
    expect(() =>
      log['store'].run(
        `INSERT INTO doc_edit_audit (ts, account_id, file_token, block_id, action) VALUES (?, ?, ?, ?, ?)`,
        1,
        'cli',
        'tok',
        'b',
        'unknown',
      ),
    ).toThrow();
  });

  it('record 失败时 swallow 不抛（不阻塞 agent edit）', () => {
    // 关闭 store 让 run 报错
    store.close();
    expect(() =>
      log.record({
        ts: 1,
        accountId: 'cli',
        fileToken: 'tok',
        blockId: 'b',
        action: 'append',
      }),
    ).not.toThrow();
  });
});
