/**
 * M8 会话级权限隔离测试
 *
 * 验证：scope='session' 权限按 sessionKey 隔离，always/deny 跨 session 共享
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import { SecurityExtension } from '../bridge/security-extension.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';
const SESSION_1 = 'agent:a:dm:user1';
const SESSION_2 = 'agent:a:dm:user2';

describe('SecurityExtension — M8 会话隔离', () => {
  let tmpDir: string;
  let store: SqliteStore;
  let security: SecurityExtension;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-iso-'));
    store = new SqliteStore(join(tmpDir, 'test.db'));
    const runner = new MigrationRunner(store);
    await runner.run();
    // 创建测试 Agent
    store.run(`INSERT INTO agents (id, name) VALUES (?, ?)`, AGENT_A, 'Agent A');
    store.run(`INSERT INTO agents (id, name) VALUES (?, ?)`, AGENT_B, 'Agent B');
    security = new SecurityExtension(store);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scope=session 授权仅在同 sessionKey 内生效', () => {
    security.grantPermission(AGENT_A, 'shell', 'session', '*', undefined, SESSION_1);
    expect(security.checkPermission(AGENT_A, 'shell', 'ls', SESSION_1)).toBe('allow');
    expect(security.checkPermission(AGENT_A, 'shell', 'ls', SESSION_2)).toBe('ask');
  });

  it('scope=session 授权不漏给同一 session 的另一 Agent', () => {
    security.grantPermission(AGENT_A, 'shell', 'session', '*', undefined, SESSION_1);
    expect(security.checkPermission(AGENT_B, 'shell', 'ls', SESSION_1)).toBe('ask');
  });

  it('scope=always 权限跨 session 共享', () => {
    security.grantPermission(AGENT_A, 'file_read', 'always');
    expect(security.checkPermission(AGENT_A, 'file_read', '/etc/hosts', SESSION_1)).toBe('allow');
    expect(security.checkPermission(AGENT_A, 'file_read', '/etc/hosts', SESSION_2)).toBe('allow');
    // 无 sessionKey 也生效
    expect(security.checkPermission(AGENT_A, 'file_read', '/etc/hosts')).toBe('allow');
  });

  it('scope=deny 在所有 session 中均拒绝', () => {
    security.grantPermission(AGENT_A, 'shell', 'deny');
    expect(security.checkPermission(AGENT_A, 'shell', 'rm', SESSION_1)).toBe('deny');
    expect(security.checkPermission(AGENT_A, 'shell', 'rm', SESSION_2)).toBe('deny');
  });

  it('scope=session 缺失 sessionKey 时抛错（防止误用）', () => {
    expect(() => security.grantPermission(AGENT_A, 'shell', 'session', '*'))
      .toThrowError(/scope='session' 需要提供 sessionKey/);
  });

  it('session 权限持久化到 DB 含 session_key 字段', () => {
    security.grantPermission(AGENT_A, 'network', 'session', 'domain:example.com', undefined, SESSION_1);
    const row = store.get<{ session_key: string; scope: string }>(
      `SELECT session_key, scope FROM permissions WHERE agent_id = ?`,
      AGENT_A,
    );
    expect(row?.session_key).toBe(SESSION_1);
    expect(row?.scope).toBe('session');
  });

  it('always/deny 持久化到 DB 时 session_key 为 NULL', () => {
    security.grantPermission(AGENT_A, 'file_read', 'always');
    const row = store.get<{ session_key: string | null }>(
      `SELECT session_key FROM permissions WHERE agent_id = ?`,
      AGENT_A,
    );
    expect(row?.session_key).toBeNull();
  });

  it('clearSessionPermissions 仅清除指定 session 的 session-scoped 权限', () => {
    security.grantPermission(AGENT_A, 'shell', 'session', '*', undefined, SESSION_1);
    security.grantPermission(AGENT_A, 'shell', 'session', '*', undefined, SESSION_2);
    security.grantPermission(AGENT_A, 'file_read', 'always');

    security.clearSessionPermissions(SESSION_1);

    expect(security.checkPermission(AGENT_A, 'shell', 'ls', SESSION_1)).toBe('ask');
    expect(security.checkPermission(AGENT_A, 'shell', 'ls', SESSION_2)).toBe('allow');
    expect(security.checkPermission(AGENT_A, 'file_read', '/tmp', SESSION_1)).toBe('allow');
  });

  it('进程重启后 DB fallback 能按 sessionKey 命中 session 权限', () => {
    security.grantPermission(AGENT_A, 'shell', 'session', '*', undefined, SESSION_1);
    // 模拟进程重启：重建 SecurityExtension（cache 空）
    security.clearCache();
    // 不走 loadCache 路径（loadCache 正常启动时会恢复），测试 fallback
    expect(security.checkPermission(AGENT_A, 'shell', 'ls', SESSION_1)).toBe('allow');
    expect(security.checkPermission(AGENT_A, 'shell', 'ls', SESSION_2)).toBe('ask');
  });
});
