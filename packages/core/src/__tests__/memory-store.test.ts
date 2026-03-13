import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryStore } from '../memory/memory-store.js';
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

/** 测试用 Agent ID */
const TEST_AGENT_ID = 'test-agent-001';

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
    l1Overview: '测试概览，描述记忆的结构化摘要',
    l2Content: '这是完整的记忆内容，包含所有细节信息。',
    confidence: 0.8,
    activation: 1.0,
    accessCount: 0,
    visibility: 'private',
    sourceConversationId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

describe('MemoryStore', () => {
  let store: SqliteStore;
  let memoryStore: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-memory-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    // 执行迁移：需要 001（agents 表）和 002（memory_units 表）
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    // 插入测试 Agent（外键约束需要）
    store.run(
      `INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`,
      TEST_AGENT_ID, '测试助手', '🤖', 'active',
    );

    memoryStore = new MemoryStore(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- insert + getById ----------

  it('insert + getById 应该完成存取往返', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);

    const fetched = memoryStore.getById(unit.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(unit.id);
    expect(fetched!.agentId).toBe(TEST_AGENT_ID);
    expect(fetched!.category).toBe('entity');
    expect(fetched!.l0Index).toBe('测试索引');
    expect(fetched!.l1Overview).toContain('测试概览');
    expect(fetched!.l2Content).toContain('完整的记忆内容');
    expect(fetched!.confidence).toBe(0.8);
    expect(fetched!.activation).toBe(1.0);
    expect(fetched!.accessCount).toBe(0);
    expect(fetched!.visibility).toBe('private');
    expect(fetched!.archivedAt).toBeNull();
  });

  it('getById 查询不存在的 ID 应返回 null', () => {
    expect(memoryStore.getById('nonexistent-id')).toBeNull();
  });

  // ---------- update ----------

  it('update 应该部分更新指定字段', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);

    // 记录插入后的 updated_at
    const beforeUpdate = memoryStore.getById(unit.id)!.updatedAt;

    // 等待至少 1ms 以确保时间戳不同
    const start = Date.now();
    while (Date.now() === start) { /* 自旋等待下一毫秒 */ }

    memoryStore.update(unit.id, {
      l0Index: '更新后的索引',
      confidence: 0.95,
    });

    const updated = memoryStore.getById(unit.id);
    expect(updated).not.toBeNull();
    expect(updated!.l0Index).toBe('更新后的索引');
    expect(updated!.confidence).toBe(0.95);
    // 未修改的字段应保持不变
    expect(updated!.l1Overview).toBe(unit.l1Overview);
    expect(updated!.l2Content).toBe(unit.l2Content);
    // updated_at 应该已更新（update 方法内会 set 新的 ISO 时间戳）
    expect(updated!.updatedAt).not.toBe(beforeUpdate);
  });

  // ---------- findByMergeKey ----------

  it('findByMergeKey 应该找到匹配的记忆', () => {
    const unit = createTestUnit({
      mergeType: 'merge',
      mergeKey: 'user_name',
    });
    memoryStore.insert(unit);

    const found = memoryStore.findByMergeKey(TEST_AGENT_ID, 'user_name');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(unit.id);
    expect(found!.mergeKey).toBe('user_name');
  });

  it('findByMergeKey 查询不存在的键应返回 null', () => {
    expect(memoryStore.findByMergeKey(TEST_AGENT_ID, 'nonexistent_key')).toBeNull();
  });

  // ---------- listByAgent ----------

  it('listByAgent 应该按 category 过滤', () => {
    // 插入不同类别的记忆
    memoryStore.insert(createTestUnit({ category: 'profile' }));
    memoryStore.insert(createTestUnit({ category: 'preference' }));
    memoryStore.insert(createTestUnit({ category: 'profile' }));

    const profiles = memoryStore.listByAgent(TEST_AGENT_ID, { category: 'profile' });
    expect(profiles).toHaveLength(2);
    profiles.forEach((m) => expect(m.category).toBe('profile'));

    const preferences = memoryStore.listByAgent(TEST_AGENT_ID, { category: 'preference' });
    expect(preferences).toHaveLength(1);
  });

  it('listByAgent 应该支持分页 (limit/offset)', () => {
    // 插入 5 条记忆，使用不同的 activation 以便确认排序
    for (let i = 0; i < 5; i++) {
      memoryStore.insert(createTestUnit({ activation: 5 - i }));
    }

    const page1 = memoryStore.listByAgent(TEST_AGENT_ID, { limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = memoryStore.listByAgent(TEST_AGENT_ID, { limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = memoryStore.listByAgent(TEST_AGENT_ID, { limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);

    // 确保不重复
    const allIds = [...page1, ...page2, ...page3].map((m) => m.id);
    expect(new Set(allIds).size).toBe(5);
  });

  it('listByAgent 默认不包含已归档的记忆', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);
    memoryStore.archive(unit.id);

    const list = memoryStore.listByAgent(TEST_AGENT_ID);
    expect(list).toHaveLength(0);
  });

  it('listByAgent 使用 includeArchived 可包含已归档记忆', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);
    memoryStore.archive(unit.id);

    const list = memoryStore.listByAgent(TEST_AGENT_ID, { includeArchived: true });
    expect(list).toHaveLength(1);
    expect(list[0].archivedAt).not.toBeNull();
  });

  // ---------- archive ----------

  it('archive 应该设置 archived_at 时间戳', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);

    memoryStore.archive(unit.id);

    const archived = memoryStore.getById(unit.id);
    expect(archived).not.toBeNull();
    expect(archived!.archivedAt).not.toBeNull();
    expect(typeof archived!.archivedAt).toBe('string');
  });

  // ---------- pin / unpin ----------

  it('pin 和 unpin 应该切换置顶状态', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);

    // 置顶
    memoryStore.pin(unit.id);
    const pinned = store.get<Record<string, unknown>>(
      'SELECT pinned FROM memory_units WHERE id = ?', unit.id,
    );
    expect(pinned?.['pinned']).toBe(1);

    // 取消置顶
    memoryStore.unpin(unit.id);
    const unpinned = store.get<Record<string, unknown>>(
      'SELECT pinned FROM memory_units WHERE id = ?', unit.id,
    );
    expect(unpinned?.['pinned']).toBe(0);
  });

  // ---------- bumpActivation ----------

  it('bumpActivation 应该递增 access_count 和 activation', () => {
    const unit = createTestUnit({ activation: 1.0 });
    memoryStore.insert(unit);

    memoryStore.bumpActivation([unit.id]);

    const bumped = memoryStore.getById(unit.id);
    expect(bumped).not.toBeNull();
    expect(bumped!.accessCount).toBe(1);
    expect(bumped!.activation).toBeCloseTo(1.1, 5);

    // 再次 bump
    memoryStore.bumpActivation([unit.id]);
    const bumped2 = memoryStore.getById(unit.id);
    expect(bumped2!.accessCount).toBe(2);
    expect(bumped2!.activation).toBeCloseTo(1.2, 5);
  });

  it('bumpActivation 传空数组不应报错', () => {
    expect(() => memoryStore.bumpActivation([])).not.toThrow();
  });

  // ---------- delete ----------

  it('delete 应该永久删除记录', () => {
    const unit = createTestUnit();
    memoryStore.insert(unit);

    memoryStore.delete(unit.id);
    expect(memoryStore.getById(unit.id)).toBeNull();
  });

  // ---------- getByIds ----------

  it('getByIds 应该返回多条完整记忆', () => {
    const unit1 = createTestUnit({ l0Index: '第一条' });
    const unit2 = createTestUnit({ l0Index: '第二条' });
    const unit3 = createTestUnit({ l0Index: '第三条' });
    memoryStore.insert(unit1);
    memoryStore.insert(unit2);
    memoryStore.insert(unit3);

    const results = memoryStore.getByIds([unit1.id, unit3.id]);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain(unit1.id);
    expect(ids).toContain(unit3.id);
  });

  it('getByIds 空数组应返回空数组', () => {
    expect(memoryStore.getByIds([])).toEqual([]);
  });

  // ---------- getL1ByIds ----------

  it('getL1ByIds 应该只返回 L0+L1 精简字段', () => {
    const unit = createTestUnit({
      l0Index: '精简索引',
      l1Overview: '精简概览',
      l2Content: '这段完整内容不应出现在 L1 投影中',
    });
    memoryStore.insert(unit);

    const results = memoryStore.getL1ByIds([unit.id]);
    expect(results).toHaveLength(1);

    const projected = results[0];
    expect(projected.id).toBe(unit.id);
    expect(projected.agentId).toBe(TEST_AGENT_ID);
    expect(projected.category).toBe('entity');
    expect(projected.l0Index).toBe('精简索引');
    expect(projected.l1Overview).toBe('精简概览');
    expect(projected.confidence).toBe(0.8);
    expect(projected.activation).toBe(1.0);

    // L1 投影不应包含 l2Content 等完整字段
    expect((projected as Record<string, unknown>)['l2Content']).toBeUndefined();
    expect((projected as Record<string, unknown>)['accessCount']).toBeUndefined();
  });

  it('getL1ByIds 空数组应返回空数组', () => {
    expect(memoryStore.getL1ByIds([])).toEqual([]);
  });
});
