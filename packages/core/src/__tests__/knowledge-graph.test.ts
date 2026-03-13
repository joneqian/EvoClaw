import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';

/** 读取迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_002 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '002_memory_units.sql'),
  'utf-8',
);
const MIGRATION_003 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '003_knowledge_graph.sql'),
  'utf-8',
);

/** 测试用常量 */
const TEST_AGENT_ID = 'test-agent-kg-001';
const TEST_MEMORY_ID = 'test-memory-001';

describe('KnowledgeGraphStore', () => {
  let store: SqliteStore;
  let kgStore: KnowledgeGraphStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-kg-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    // 执行迁移：001 → 002 → 003
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    store.exec(MIGRATION_003);

    // 插入测试 Agent（外键约束需要）
    store.run(
      `INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`,
      TEST_AGENT_ID, '知识图谱测试助手', '🧠', 'active',
    );

    // 插入测试记忆单元（source_memory_id 外键引用需要）
    const now = new Date().toISOString();
    store.run(
      `INSERT INTO memory_units (id, agent_id, l0_index, l1_overview, l2_content, category, merge_type, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      TEST_MEMORY_ID, TEST_AGENT_ID, '测试记忆索引', '测试记忆概览', '测试记忆完整内容',
      'entity', 'independent', 0.9, now, now,
    );

    kgStore = new KnowledgeGraphStore(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- insertRelation + queryBySubject ----------

  it('insertRelation 应该返回生成的 ID，queryBySubject 应查到该关系', () => {
    const id = kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '使用',
      objectId: 'TypeScript',
      confidence: 0.9,
      sourceMemoryId: TEST_MEMORY_ID,
    });

    expect(id).toBeDefined();
    expect(typeof id).toBe('string');

    const results = kgStore.queryBySubject('张三');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(id);
    expect(results[0].agentId).toBe(TEST_AGENT_ID);
    expect(results[0].subjectId).toBe('张三');
    expect(results[0].relation).toBe('使用');
    expect(results[0].objectId).toBe('TypeScript');
    expect(results[0].confidence).toBe(0.9);
  });

  it('queryBySubject 带谓词过滤应仅返回匹配项', () => {
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '喜欢',
      objectId: 'React',
      confidence: 0.8,
    });
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '使用',
      objectId: 'Vue',
      confidence: 0.7,
    });

    const likes = kgStore.queryBySubject('张三', '喜欢');
    expect(likes).toHaveLength(1);
    expect(likes[0].objectId).toBe('React');

    const uses = kgStore.queryBySubject('张三', '使用');
    expect(uses).toHaveLength(1);
    expect(uses[0].objectId).toBe('Vue');
  });

  // ---------- queryByObject ----------

  it('queryByObject 应返回以实体为宾语的所有关系', () => {
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '使用',
      objectId: 'Python',
      confidence: 0.85,
    });
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '李四',
      predicate: '学习',
      objectId: 'Python',
      confidence: 0.75,
    });

    const results = kgStore.queryByObject('Python');
    expect(results).toHaveLength(2);
    const subjects = results.map((r) => r.subjectId);
    expect(subjects).toContain('张三');
    expect(subjects).toContain('李四');
  });

  it('queryByObject 带谓词过滤应仅返回匹配项', () => {
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '使用',
      objectId: 'Rust',
      confidence: 0.8,
    });
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '李四',
      predicate: '学习',
      objectId: 'Rust',
      confidence: 0.6,
    });

    const learners = kgStore.queryByObject('Rust', '学习');
    expect(learners).toHaveLength(1);
    expect(learners[0].subjectId).toBe('李四');
  });

  // ---------- queryBoth ----------

  it('queryBoth 应返回实体作为主语或宾语的并集', () => {
    // 张三作为主语
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '认识',
      objectId: '李四',
      confidence: 0.9,
    });
    // 张三作为宾语
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '王五',
      predicate: '指导',
      objectId: '张三',
      confidence: 0.85,
    });
    // 不相关的关系
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '李四',
      predicate: '使用',
      objectId: 'Go',
      confidence: 0.7,
    });

    const results = kgStore.queryBoth('张三');
    expect(results).toHaveLength(2);

    const predicates = results.map((r) => r.relation);
    expect(predicates).toContain('认识');
    expect(predicates).toContain('指导');
  });

  // ---------- expandEntities ----------

  it('expandEntities 应返回涉及任意给定实体集的所有关系', () => {
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '使用',
      objectId: 'TypeScript',
      confidence: 0.9,
    });
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '李四',
      predicate: '学习',
      objectId: 'Python',
      confidence: 0.8,
    });
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '王五',
      predicate: '精通',
      objectId: 'Rust',
      confidence: 0.95,
    });

    // 只查询涉及张三和李四的关系
    const results = kgStore.expandEntities(['张三', '李四']);
    expect(results).toHaveLength(2);
    const subjects = results.map((r) => r.subjectId);
    expect(subjects).toContain('张三');
    expect(subjects).toContain('李四');
    expect(subjects).not.toContain('王五');
  });

  it('expandEntities 空数组应返回空数组', () => {
    expect(kgStore.expandEntities([])).toEqual([]);
  });

  // ---------- deleteByMemorySource ----------

  it('deleteByMemorySource 应删除指定来源记忆的所有关系', () => {
    // 关联到测试记忆的关系
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '提到',
      objectId: '项目A',
      confidence: 0.8,
      sourceMemoryId: TEST_MEMORY_ID,
    });
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '张三',
      predicate: '参与',
      objectId: '项目B',
      confidence: 0.7,
      sourceMemoryId: TEST_MEMORY_ID,
    });
    // 无关联的关系
    kgStore.insertRelation({
      agentId: TEST_AGENT_ID,
      subjectId: '李四',
      predicate: '管理',
      objectId: '项目C',
      confidence: 0.9,
    });

    // 删除关联到测试记忆的关系
    kgStore.deleteByMemorySource(TEST_MEMORY_ID);

    // 关联的应被删除
    const zhangResults = kgStore.queryBySubject('张三');
    expect(zhangResults).toHaveLength(0);

    // 无关联的应保留
    const liResults = kgStore.queryBySubject('李四');
    expect(liResults).toHaveLength(1);
    expect(liResults[0].objectId).toBe('项目C');
  });

  it('queryBySubject 查询不存在的实体应返回空数组', () => {
    expect(kgStore.queryBySubject('不存在的实体')).toEqual([]);
  });
});
