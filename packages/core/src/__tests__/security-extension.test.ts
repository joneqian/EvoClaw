import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import { SecurityExtension } from '../bridge/security-extension.js';

/** 生成临时数据库路径 */
function tmpDbPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'test.db');
}

const TEST_AGENT_ID = 'agent-test-001';

describe('SecurityExtension', () => {
  let store: SqliteStore;
  let security: SecurityExtension;

  beforeEach(async () => {
    store = new SqliteStore(tmpDbPath());
    const runner = new MigrationRunner(store);
    await runner.run();
    // 创建测试 Agent（外键约束需要）
    store.run(
      `INSERT INTO agents (id, name, status) VALUES (?, ?, 'active')`,
      TEST_AGENT_ID, '测试 Agent',
    );
    security = new SecurityExtension(store);
  });

  afterEach(() => {
    try {
      const dbPath = store.dbPath;
      store.close();
      if (dbPath.includes(os.tmpdir())) {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      }
    } catch {
      // 忽略清理错误
    }
  });

  it('默认返回 ask', () => {
    const result = security.checkPermission(TEST_AGENT_ID, 'file_read');
    expect(result).toBe('ask');
  });

  it('always 权限授予后返回 allow', () => {
    security.grantPermission(TEST_AGENT_ID, 'file_read', 'always');
    const result = security.checkPermission(TEST_AGENT_ID, 'file_read');
    expect(result).toBe('allow');
  });

  it('deny 权限授予后返回 deny', () => {
    security.grantPermission(TEST_AGENT_ID, 'shell', 'deny');
    const result = security.checkPermission(TEST_AGENT_ID, 'shell');
    expect(result).toBe('deny');
  });

  it('once 权限在首次检查后消耗', () => {
    security.grantPermission(TEST_AGENT_ID, 'network', 'once');
    const first = security.checkPermission(TEST_AGENT_ID, 'network');
    expect(first).toBe('allow');
    // 第二次应返回 ask（已消耗）
    const second = security.checkPermission(TEST_AGENT_ID, 'network');
    expect(second).toBe('ask');
  });

  it('revokePermission 从数据库和缓存中移除', () => {
    const id = security.grantPermission(TEST_AGENT_ID, 'file_write', 'always');
    // 先确认生效
    expect(security.checkPermission(TEST_AGENT_ID, 'file_write')).toBe('allow');
    // 撤销
    security.revokePermission(id);
    expect(security.checkPermission(TEST_AGENT_ID, 'file_write')).toBe('ask');
    // 数据库中也不存在
    const row = store.get('SELECT * FROM permissions WHERE id = ?', id);
    expect(row).toBeUndefined();
  });

  it('listPermissions 返回 Agent 的所有权限', () => {
    security.grantPermission(TEST_AGENT_ID, 'file_read', 'always');
    security.grantPermission(TEST_AGENT_ID, 'shell', 'deny');
    security.grantPermission(TEST_AGENT_ID, 'network', 'session', '*', undefined, 'test-session');
    const list = security.listPermissions(TEST_AGENT_ID);
    expect(list).toHaveLength(3);
    const categories = list.map(r => r.category).sort();
    expect(categories).toEqual(['file_read', 'network', 'shell']);
  });

  it('过期权限自动清理', () => {
    // 插入已过期的 always 权限
    const id = crypto.randomUUID();
    const pastDate = '2020-01-01T00:00:00.000Z';
    store.run(
      `INSERT INTO permissions (id, agent_id, category, scope, resource, granted_at, expires_at, granted_by)
       VALUES (?, ?, 'browser', 'always', '*', datetime('now'), ?, 'user')`,
      id, TEST_AGENT_ID, pastDate,
    );
    // 重新构建 SecurityExtension 以加载缓存
    security = new SecurityExtension(store);
    // 检查时应发现过期并清理，返回 ask
    const result = security.checkPermission(TEST_AGENT_ID, 'browser');
    expect(result).toBe('ask');
    // 数据库中已删除
    const row = store.get('SELECT * FROM permissions WHERE id = ?', id);
    expect(row).toBeUndefined();
  });

  it('授予权限时写入审计日志', () => {
    security.grantPermission(TEST_AGENT_ID, 'mcp', 'always');
    const log = store.get<Record<string, unknown>>(
      `SELECT * FROM audit_log WHERE agent_id = ? AND action = 'permission_grant'`,
      TEST_AGENT_ID,
    );
    expect(log).toBeDefined();
    const details = JSON.parse(log!['details'] as string);
    expect(details.category).toBe('mcp');
    expect(details.scope).toBe('always');
  });

  it('精确资源匹配优先于通配符', () => {
    // 通配符允许
    security.grantPermission(TEST_AGENT_ID, 'file_read', 'always', '*');
    // 精确资源拒绝
    security.grantPermission(TEST_AGENT_ID, 'file_read', 'deny', '/secret');
    const wildcard = security.checkPermission(TEST_AGENT_ID, 'file_read', '/public');
    expect(wildcard).toBe('allow');
    const exact = security.checkPermission(TEST_AGENT_ID, 'file_read', '/secret');
    expect(exact).toBe('deny');
  });
});
