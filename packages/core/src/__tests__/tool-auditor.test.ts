import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import { ToolAuditor, type ToolAuditEntry } from '../bridge/tool-injector.js';

/** 生成临时数据库路径 */
function tmpDbPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'test.db');
}

describe('ToolAuditor', () => {
  let store: SqliteStore;
  let auditor: ToolAuditor;
  const testAgentId = 'agent-test-001';
  const testSessionKey = `agent:${testAgentId}:default:direct:user1`;

  beforeEach(async () => {
    store = new SqliteStore(tmpDbPath());

    // 执行迁移（001 创建 agents 表，006 创建 tool_audit_log 表）
    const runner = new MigrationRunner(store);
    await runner.run();

    // 插入测试 Agent（外键依赖）
    store.run(
      `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
      testAgentId, '测试Agent', '🤖', 'active', '{}',
    );

    auditor = new ToolAuditor(store);
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

  it('应该记录工具执行条目并返回 id', () => {
    const id = auditor.log({
      agentId: testAgentId,
      sessionKey: testSessionKey,
      toolName: 'file_read',
      inputJson: JSON.stringify({ path: '/tmp/test.txt' }),
      outputJson: JSON.stringify({ content: 'hello' }),
      status: 'success',
      durationMs: 42,
    });

    expect(id).toBeTruthy();
    // 验证数据库中存在该记录
    const row = store.get<{ id: string; tool_name: string }>(
      'SELECT id, tool_name FROM tool_audit_log WHERE id = ?', id,
    );
    expect(row).toBeDefined();
    expect(row!.tool_name).toBe('file_read');
  });

  it('应该通过 listByAgent 查询 Agent 的执行记录', () => {
    // 写入多条记录
    auditor.log({
      agentId: testAgentId,
      sessionKey: testSessionKey,
      toolName: 'file_read',
      status: 'success',
      durationMs: 10,
    });
    auditor.log({
      agentId: testAgentId,
      sessionKey: testSessionKey,
      toolName: 'shell_exec',
      status: 'error',
      durationMs: 200,
    });

    const entries = auditor.listByAgent(testAgentId);
    expect(entries).toHaveLength(2);
    // 按 created_at DESC 排序，最新在前
    expect(entries.map(e => e.toolName)).toContain('file_read');
    expect(entries.map(e => e.toolName)).toContain('shell_exec');
  });

  it('应该通过 listBySession 查询 Session 的执行记录', () => {
    const sessionA = `agent:${testAgentId}:default:direct:userA`;
    const sessionB = `agent:${testAgentId}:default:direct:userB`;

    auditor.log({
      agentId: testAgentId,
      sessionKey: sessionA,
      toolName: 'file_read',
      status: 'success',
    });
    auditor.log({
      agentId: testAgentId,
      sessionKey: sessionB,
      toolName: 'shell_exec',
      status: 'success',
    });

    const entriesA = auditor.listBySession(sessionA);
    expect(entriesA).toHaveLength(1);
    expect(entriesA[0]!.toolName).toBe('file_read');

    const entriesB = auditor.listBySession(sessionB);
    expect(entriesB).toHaveLength(1);
    expect(entriesB[0]!.toolName).toBe('shell_exec');
  });

  it('应该正确记录所有 status 值', () => {
    const statuses: Array<'success' | 'error' | 'denied' | 'timeout'> = [
      'success', 'error', 'denied', 'timeout',
    ];

    for (const status of statuses) {
      auditor.log({
        agentId: testAgentId,
        sessionKey: testSessionKey,
        toolName: `tool_${status}`,
        status,
      });
    }

    const entries = auditor.listByAgent(testAgentId);
    expect(entries).toHaveLength(4);

    const recordedStatuses = entries.map(e => e.status).sort();
    expect(recordedStatuses).toEqual(['denied', 'error', 'success', 'timeout']);
  });

  it('应该支持可选字段为 null', () => {
    const id = auditor.log({
      agentId: testAgentId,
      sessionKey: testSessionKey,
      toolName: 'minimal_tool',
      status: 'denied',
      // 不传 inputJson, outputJson, durationMs, permissionId
    });

    const entries = auditor.listByAgent(testAgentId);
    const entry = entries.find(e => e.id === id)!;
    expect(entry.inputJson).toBeNull();
    expect(entry.outputJson).toBeNull();
    expect(entry.durationMs).toBeNull();
    expect(entry.permissionId).toBeNull();
  });

  it('应该遵守 limit 参数', () => {
    // 写入 5 条记录
    for (let i = 0; i < 5; i++) {
      auditor.log({
        agentId: testAgentId,
        sessionKey: testSessionKey,
        toolName: `tool_${i}`,
        status: 'success',
      });
    }

    const limited = auditor.listByAgent(testAgentId, 3);
    expect(limited).toHaveLength(3);
  });
});
