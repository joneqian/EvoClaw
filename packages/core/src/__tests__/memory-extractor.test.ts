import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryExtractor, type LLMCallFn } from '../memory/memory-extractor.js';
import { MemoryStore } from '../memory/memory-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import type { ChatMessage } from '@evoclaw/shared';

/** 读取所有迁移 SQL（001-006） */
const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_FILES = [
  '001_initial.sql',
  '002_memory_units.sql',
  '003_knowledge_graph.sql',
  '004_conversation_log.sql',
  '005_capability_graph.sql',
  '006_tool_audit_log.sql',
];
const MIGRATION_SQLS = MIGRATION_FILES.map(f =>
  fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')
);

/** 创建测试用 Agent 记录 */
function insertTestAgent(store: SqliteStore, agentId: string): void {
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
    agentId, '测试助手', '🤖', 'active', '{}',
  );
}

/** 构建测试用聊天消息列表 */
function makeMessages(contents: Array<{ role: 'user' | 'assistant'; text: string }>): ChatMessage[] {
  return contents.map((c, i) => ({
    id: `msg-${i}-${crypto.randomUUID()}`,
    conversationId: 'conv-test-001',
    role: c.role,
    content: c.text,
    createdAt: new Date().toISOString(),
  }));
}

/**
 * 构建模拟 LLM 函数，返回包含记忆和关系的有效 XML
 * 支持自定义 mergeKey 来测试合并行为
 */
function makeMockLLM(mergeKey?: string): LLMCallFn {
  return async (_system: string, _user: string): Promise<string> => {
    const mergeType = mergeKey ? 'merge' : 'independent';
    const mergeKeyTag = mergeKey ? `<merge_key>${mergeKey}</merge_key>` : '<merge_key>null</merge_key>';

    return `<extraction>
  <memories>
    <memory>
      <category>preference</category>
      <merge_type>${mergeType}</merge_type>
      ${mergeKeyTag}
      <l0_index>用户偏好使用 Vim 编辑器</l0_index>
      <l1_overview>用户在日常开发中偏好使用 Vim 作为主要编辑器，配合 NeoVim 插件体系。</l1_overview>
      <l2_content>用户表示自己使用 Vim 已有多年经验，特别喜欢其模态编辑方式和高效的快捷键操作。目前使用 NeoVim + Lua 配置。</l2_content>
      <confidence>0.85</confidence>
    </memory>
  </memories>
  <relations>
    <relation>
      <subject>user</subject>
      <predicate>prefers</predicate>
      <object>Vim</object>
      <confidence>0.85</confidence>
    </relation>
    <relation>
      <subject>user</subject>
      <predicate>uses</predicate>
      <object>NeoVim</object>
      <confidence>0.8</confidence>
    </relation>
  </relations>
</extraction>`;
  };
}

/** 返回 <no_extraction/> 的模拟 LLM 函数 */
function makeMockLLMNoExtraction(): LLMCallFn {
  return async (_system: string, _user: string): Promise<string> => {
    return '<no_extraction/>';
  };
}

describe('MemoryExtractor（集成测试）', () => {
  let store: SqliteStore;
  let memoryStore: MemoryStore;
  let knowledgeGraph: KnowledgeGraphStore;
  let tmpDir: string;
  const agentId = 'agent-extractor-test-001';

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-extractor-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    // 执行所有迁移（001-006）
    for (const sql of MIGRATION_SQLS) {
      store.exec(sql);
    }
    insertTestAgent(store, agentId);

    memoryStore = new MemoryStore(store);
    knowledgeGraph = new KnowledgeGraphStore(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extractAndPersist 处理有效消息应返回 memoryIds 和 relationCount', async () => {
    const extractor = new MemoryExtractor(store, makeMockLLM());
    const messages = makeMessages([
      { role: 'user', text: '我平时写代码主要用 Vim，配合 NeoVim 的 Lua 配置。' },
      { role: 'assistant', text: '了解，Vim 是一个非常高效的编辑器。' },
    ]);

    const result = await extractor.extractAndPersist(messages, agentId);

    expect(result.skipped).toBe(false);
    expect(result.memoryIds).toHaveLength(1);
    expect(result.relationCount).toBe(2);
  });

  it('extractAndPersist 处理空/过短消息应返回 skipped: true', async () => {
    const extractor = new MemoryExtractor(store, makeMockLLM());

    // 空消息列表
    const result1 = await extractor.extractAndPersist([], agentId);
    expect(result1.skipped).toBe(true);
    expect(result1.memoryIds).toHaveLength(0);

    // 仅含 system 消息（被 filter 过滤后为空文本）
    const systemOnlyMessages = makeMessages([
      { role: 'system' as 'user', text: '你是一个助手' },
    ]);
    const result2 = await extractor.extractAndPersist(systemOnlyMessages, agentId);
    expect(result2.skipped).toBe(true);
  });

  it('LLM 返回 <no_extraction/> 时应返回 skipped: true', async () => {
    const extractor = new MemoryExtractor(store, makeMockLLMNoExtraction());
    const messages = makeMessages([
      { role: 'user', text: '今天天气怎么样？这个问题没什么值得记忆的。' },
      { role: 'assistant', text: '今天是晴天，温度适宜。' },
    ]);

    const result = await extractor.extractAndPersist(messages, agentId);

    expect(result.skipped).toBe(true);
    expect(result.memoryIds).toHaveLength(0);
    expect(result.relationCount).toBe(0);
  });

  it('记忆应被持久化到数据库中（通过 MemoryStore 查询验证）', async () => {
    const extractor = new MemoryExtractor(store, makeMockLLM());
    const messages = makeMessages([
      { role: 'user', text: '我日常使用 Vim 编辑器进行所有开发工作。' },
      { role: 'assistant', text: '很好的选择，Vim 的效率很高。' },
    ]);

    const result = await extractor.extractAndPersist(messages, agentId);

    // 通过 MemoryStore 查询已持久化的记忆
    const units = memoryStore.listByAgent(agentId);
    expect(units).toHaveLength(1);
    expect(units[0].id).toBe(result.memoryIds[0]);
    expect(units[0].category).toBe('preference');
    expect(units[0].l0Index).toContain('Vim');
    expect(units[0].confidence).toBe(0.85);
  });

  it('关系应被持久化到 knowledge_graph（通过 KnowledgeGraphStore 查询验证）', async () => {
    const extractor = new MemoryExtractor(store, makeMockLLM());
    const messages = makeMessages([
      { role: 'user', text: '我的开发工具链主要是 Vim + NeoVim + Lua。' },
      { role: 'assistant', text: '这是一个非常强大的组合。' },
    ]);

    await extractor.extractAndPersist(messages, agentId);

    // 通过 KnowledgeGraphStore 查询 user 为主语的关系
    const relations = knowledgeGraph.queryBySubject('user');
    expect(relations).toHaveLength(2);

    // 验证关系内容
    const predicates = relations.map(r => r.relation).sort();
    expect(predicates).toEqual(['prefers', 'uses']);
  });

  it('合并行为：相同 mergeKey 两次 extractAndPersist 应更新已有记录', async () => {
    const mergeKey = 'preference:editor';

    // 第一次提取
    const extractor1 = new MemoryExtractor(store, makeMockLLM(mergeKey));
    const messages1 = makeMessages([
      { role: 'user', text: '我最喜欢的编辑器是 Vim。' },
      { role: 'assistant', text: '好的，已记录你的编辑器偏好。' },
    ]);
    const result1 = await extractor1.extractAndPersist(messages1, agentId);
    expect(result1.memoryIds).toHaveLength(1);

    // 记录第一次的 ID
    const firstId = result1.memoryIds[0];
    const firstUnit = memoryStore.getById(firstId)!;
    expect(firstUnit).not.toBeNull();

    // 第二次提取（相同 mergeKey，更新后的 LLM 会返回同 mergeKey 的记忆）
    const extractor2 = new MemoryExtractor(store, makeMockLLM(mergeKey));
    const messages2 = makeMessages([
      { role: 'user', text: '其实我现在更多用 NeoVim 了，配合 Lua 生态。' },
      { role: 'assistant', text: '了解，NeoVim 的确越来越流行。' },
    ]);
    const result2 = await extractor2.extractAndPersist(messages2, agentId);

    // 应返回相同的 ID（合并更新，而非新建）
    expect(result2.memoryIds).toHaveLength(1);
    expect(result2.memoryIds[0]).toBe(firstId);

    // 数据库中应仍只有一条记忆（被合并更新了）
    const allUnits = memoryStore.listByAgent(agentId);
    expect(allUnits).toHaveLength(1);

    // 验证 activation 被提升
    const updatedUnit = memoryStore.getById(firstId)!;
    expect(updatedUnit.activation).toBeGreaterThan(firstUnit.activation);
  });
});
