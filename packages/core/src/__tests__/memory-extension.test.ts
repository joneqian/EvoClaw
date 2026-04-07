import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryExtension } from '../bridge/memory-extension.js';
import type { LLMCallFn } from '../memory/memory-extractor.js';

/** 读取迁移 SQL（001-006） */
const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');
const MIGRATION_002 = fs.readFileSync(path.join(migrationsDir, '002_memory_units.sql'), 'utf-8');
const MIGRATION_003 = fs.readFileSync(path.join(migrationsDir, '003_knowledge_graph.sql'), 'utf-8');
const MIGRATION_004 = fs.readFileSync(path.join(migrationsDir, '004_conversation_log.sql'), 'utf-8');
const MIGRATION_005 = fs.readFileSync(path.join(migrationsDir, '005_capability_graph.sql'), 'utf-8');
const MIGRATION_021 = fs.readFileSync(path.join(migrationsDir, '021_conversation_log_hierarchy.sql'), 'utf-8');
const MIGRATION_006 = fs.readFileSync(path.join(migrationsDir, '006_tool_audit_log.sql'), 'utf-8');

/** 测试用 Agent ID */
const TEST_AGENT_ID = 'agent-memext-test-001';

/** 创建测试用 Agent 记录 */
function insertTestAgent(store: SqliteStore, agentId: string): void {
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
    agentId, '记忆桥接测试助手', '🧠', 'active', '{}',
  );
}

/** 模拟 LLM 调用函数 — 返回空提取结果 */
const mockLlmCall: LLMCallFn = async (_system: string, _user: string) => {
  return '<memories></memories><relations></relations>';
};

describe('MemoryExtension', () => {
  let store: SqliteStore;
  let ext: MemoryExtension;
  let tmpDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-memext-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    workspaceDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    // 执行所有迁移（001-006）
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    store.exec(MIGRATION_003);
    store.exec(MIGRATION_004);
    store.exec(MIGRATION_021);
    store.exec(MIGRATION_005);
    store.exec(MIGRATION_006);

    insertTestAgent(store, TEST_AGENT_ID);

    ext = new MemoryExtension(store, mockLlmCall);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('构造 MemoryExtension 不应抛出异常', () => {
    // 已在 beforeEach 中成功构造，此处验证实例存在
    expect(ext).toBeDefined();
    expect(ext).toBeInstanceOf(MemoryExtension);
  });

  it('beforeAgentStart 应写入 USER.md 和 MEMORY.md 到工作区', async () => {
    const context = await ext.beforeAgentStart(TEST_AGENT_ID, workspaceDir);

    // 验证文件已写入
    const userMdPath = path.join(workspaceDir, 'USER.md');
    const memoryMdPath = path.join(workspaceDir, 'MEMORY.md');
    expect(fs.existsSync(userMdPath)).toBe(true);
    expect(fs.existsSync(memoryMdPath)).toBe(true);

    // 验证文件内容不为空（至少包含标题）
    const userMdContent = fs.readFileSync(userMdPath, 'utf-8');
    const memoryMdContent = fs.readFileSync(memoryMdPath, 'utf-8');
    expect(userMdContent).toContain('# 用户画像');
    expect(memoryMdContent).toContain('# 活跃记忆');

    // 返回的上下文应包含两份 Markdown 的拼接
    expect(context).toContain('# 用户画像');
    expect(context).toContain('# 活跃记忆');
  });

  it('beforeTurn 在无匹配记忆时返回空字符串', async () => {
    const result = await ext.beforeTurn(TEST_AGENT_ID, '这是一条随机测试消息');
    expect(result).toBe('');
  });

  it('logToolResult 应记录到 conversation_log 表', () => {
    const sessionKey = 'session-tool-test-001';
    const toolName = 'file_read';
    const input = '{"path": "/tmp/test.txt"}';
    const output = '文件内容示例';

    // 执行工具记录
    ext.logToolResult(TEST_AGENT_ID, sessionKey, toolName, input, output);

    // 直接查询数据库验证
    const row = store.get<{
      agent_id: string;
      session_key: string;
      role: string;
      content: string;
      tool_name: string;
      tool_input: string;
      tool_output: string;
      token_count: number;
    }>(
      `SELECT agent_id, session_key, role, content, tool_name, tool_input, tool_output, token_count
       FROM conversation_log
       WHERE agent_id = ? AND session_key = ?`,
      TEST_AGENT_ID,
      sessionKey,
    );

    expect(row).toBeDefined();
    expect(row!.agent_id).toBe(TEST_AGENT_ID);
    expect(row!.session_key).toBe(sessionKey);
    expect(row!.role).toBe('tool');
    expect(row!.content).toBe('Tool: file_read');
    expect(row!.tool_name).toBe(toolName);
    expect(row!.tool_input).toBe(input);
    expect(row!.tool_output).toBe(output);
    // token_count = ceil((input.length + output.length) / 4)
    const expectedTokens = Math.ceil((input.length + output.length) / 4);
    expect(row!.token_count).toBe(expectedTokens);
  });

  it('afterAgentEnd 不应在空消息列表时抛出', async () => {
    // 传入空消息列表，应安全执行（extractAndPersist 内部 sanitize 返回 null → skipped）
    await expect(ext.afterAgentEnd([], TEST_AGENT_ID)).resolves.toBeUndefined();
  });

  it('beforeCompact 在无待处理消息时应安全返回', async () => {
    await expect(ext.beforeCompact(TEST_AGENT_ID, 'session-compact-001')).resolves.toBeUndefined();
  });
});
