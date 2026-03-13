import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { FtsStore } from '../infrastructure/db/fts-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import { MemoryStore } from '../memory/memory-store.js';
import { HybridSearcher } from '../memory/hybrid-searcher.js';
import type { MemoryUnit } from '@evoclaw/shared';

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

/** 测试用 Agent ID */
const TEST_AGENT_ID = 'test-agent-hybrid';

/** 创建一个完整的测试记忆单元 */
function createTestUnit(overrides: Partial<MemoryUnit> = {}): MemoryUnit {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: TEST_AGENT_ID,
    category: 'entity',
    mergeType: 'independent',
    mergeKey: null,
    l0Index: '测试索引',
    l1Overview: '测试概览',
    l2Content: '完整的记忆内容，包含所有细节。',
    confidence: 0.8,
    activation: 1.0,
    accessCount: 1,
    visibility: 'private',
    sourceConversationId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

describe('HybridSearcher', () => {
  let sqliteStore: SqliteStore;
  let ftsStore: FtsStore;
  let vectorStore: VectorStore;
  let knowledgeGraph: KnowledgeGraphStore;
  let memoryStore: MemoryStore;
  let searcher: HybridSearcher;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-hybrid-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    sqliteStore = new SqliteStore(dbPath);
    // 执行迁移 001 + 002 + 003
    sqliteStore.exec(MIGRATION_001);
    sqliteStore.exec(MIGRATION_002);
    sqliteStore.exec(MIGRATION_003);

    // 插入测试 Agent（外键约束需要）
    sqliteStore.run(
      `INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`,
      TEST_AGENT_ID, '混合搜索测试助手', '🔍', 'active',
    );

    ftsStore = new FtsStore(sqliteStore);
    vectorStore = new VectorStore();
    knowledgeGraph = new KnowledgeGraphStore(sqliteStore);
    memoryStore = new MemoryStore(sqliteStore);
    searcher = new HybridSearcher(ftsStore, vectorStore, knowledgeGraph, memoryStore);
  });

  afterEach(() => {
    try { sqliteStore.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 插入记忆并建立 FTS 索引的辅助函数 */
  function insertAndIndex(unit: MemoryUnit): void {
    memoryStore.insert(unit);
    ftsStore.indexMemory(unit.id, unit.l0Index, unit.l1Overview);
  }

  // ---------- hybridSearch 返回匹配结果 ----------

  it('hybridSearch 应返回匹配查询的结果', async () => {
    const unit = createTestUnit({
      l0Index: 'TypeScript 编程',
      l1Overview: '用户擅长 TypeScript 和 React 开发',
    });
    insertAndIndex(unit);

    const results = await searcher.hybridSearch('TypeScript 开发', TEST_AGENT_ID);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].memoryId).toBe(unit.id);
    expect(results[0].l0Index).toBe('TypeScript 编程');
  });

  // ---------- 结果按 finalScore 降序排列 ----------

  it('hybridSearch 结果应按 finalScore 降序排列', async () => {
    // 插入多条记忆，关键词匹配度不同
    const unit1 = createTestUnit({
      l0Index: 'Python 数据分析',
      l1Overview: 'Python 在数据科学领域的应用，包括 pandas 和 numpy',
    });
    const unit2 = createTestUnit({
      l0Index: 'Python 机器学习',
      l1Overview: 'Python 机器学习框架，scikit-learn 和 TensorFlow',
    });
    const unit3 = createTestUnit({
      l0Index: '前端开发',
      l1Overview: 'React 和 Vue 前端框架对比',
    });
    insertAndIndex(unit1);
    insertAndIndex(unit2);
    insertAndIndex(unit3);

    const results = await searcher.hybridSearch('Python', TEST_AGENT_ID);

    // 验证降序排列
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].finalScore).toBeGreaterThanOrEqual(results[i].finalScore);
    }
  });

  // ---------- merge_key 去重：同 key 只保留最高分 ----------

  it('hybridSearch 应对相同 merge_key 的记忆只保留最高分', async () => {
    const sharedMergeKey = 'user-preference-editor';

    // 两条记忆共享 merge_key，但 activation 不同以产生不同分数
    const unit1 = createTestUnit({
      mergeKey: sharedMergeKey,
      mergeType: 'merge',
      l0Index: 'editor preference',
      l1Overview: 'user prefers VS Code editor',
      activation: 0.5,
    });
    const unit2 = createTestUnit({
      mergeKey: sharedMergeKey,
      mergeType: 'merge',
      l0Index: 'editor preference updated',
      l1Overview: 'user now prefers Neovim editor',
      activation: 2.0,
    });
    insertAndIndex(unit1);
    insertAndIndex(unit2);

    const results = await searcher.hybridSearch('editor preference', TEST_AGENT_ID);

    // 同一 merge_key 只应出现一条结果
    const editorResults = results.filter(
      r => r.memoryId === unit1.id || r.memoryId === unit2.id,
    );
    expect(editorResults.length).toBe(1);
  });

  // ---------- 空查询返回空结果 ----------

  it('hybridSearch 对空查询应返回空结果', async () => {
    const unit = createTestUnit({
      l0Index: '测试记忆',
      l1Overview: '这是一条测试记忆',
    });
    insertAndIndex(unit);

    // 空查询 → 无关键词 → 无 FTS 候选 → 空结果
    const results = await searcher.hybridSearch('', TEST_AGENT_ID);
    expect(results).toEqual([]);
  });

  // ---------- bumpActivation 被调用 ----------

  it('hybridSearch 应对召回的记忆调用 bumpActivation', async () => {
    const unit = createTestUnit({
      l0Index: 'Rust programming',
      l1Overview: 'Learning Rust ownership model and lifetimes',
    });
    insertAndIndex(unit);

    // 监视 bumpActivation 方法
    const bumpSpy = vi.spyOn(memoryStore, 'bumpActivation');

    await searcher.hybridSearch('Rust ownership', TEST_AGENT_ID);

    expect(bumpSpy).toHaveBeenCalled();
    // 验证传入的 ID 包含被召回的记忆
    const calledIds = bumpSpy.mock.calls[0][0];
    expect(calledIds).toContain(unit.id);

    bumpSpy.mockRestore();
  });

  // ---------- Phase 3: L2 按需加载 ----------

  it('hybridSearch 在 loadL2=true 时应加载 L2 内容', async () => {
    const l2Content = '这是非常详细的 L2 内容，包含了 Kubernetes 集群配置的完整步骤和注意事项。';
    const unit = createTestUnit({
      l0Index: 'Kubernetes 运维',
      l1Overview: 'K8s 集群部署和管理经验',
      l2Content,
    });
    insertAndIndex(unit);

    const results = await searcher.hybridSearch('Kubernetes', TEST_AGENT_ID, { loadL2: true });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].l2Content).toBe(l2Content);
  });

  it('hybridSearch 查询包含"详细"时应自动加载 L2 内容', async () => {
    const l2Content = 'Docker 容器管理的完整文档，涵盖镜像构建、网络配置和存储卷管理。';
    const unit = createTestUnit({
      l0Index: 'Docker containerization',
      l1Overview: 'Docker container management and orchestration',
      l2Content,
    });
    insertAndIndex(unit);

    // "详细" 触发 needsDetail=true；"Docker" 和 "containerization" 保证 FTS 匹配
    // 注意: FTS5 默认隐式 AND，所有关键词必须在索引中出现
    // "详细" 不在停用词中但也不在索引里，所以把它加入 l1Overview
    ftsStore.updateIndex(unit.id, unit.l0Index, 'Docker container management 详细 orchestration');
    const results = await searcher.hybridSearch('详细 Docker', TEST_AGENT_ID);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].l2Content).toBe(l2Content);
  });

  it('hybridSearch 默认不加载 L2 内容', async () => {
    const unit = createTestUnit({
      l0Index: 'Go concurrency',
      l1Overview: 'Goroutine and Channel usage patterns',
      l2Content: '这是 L2 详细内容',
    });
    insertAndIndex(unit);

    const results = await searcher.hybridSearch('Go concurrency', TEST_AGENT_ID);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // 默认不加载 L2
    expect(results[0].l2Content).toBeUndefined();
  });
});
