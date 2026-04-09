/**
 * MemoryFeedbackStore 单元测试 — Sprint 15.12 Phase B.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryStore } from '../memory/memory-store.js';
import { MemoryFeedbackStore, CONFIDENCE_DECAY_STEP } from '../memory/memory-feedback-store.js';
import type { MemoryUnit } from '@evoclaw/shared';

/** 加载迁移 — 001 (agents) + 002 (memory_units) + 025 (memory_feedback) */
const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_002 = fs.readFileSync(path.join(MIGRATIONS_DIR, '002_memory_units.sql'), 'utf-8');
const MIGRATION_025 = fs.readFileSync(path.join(MIGRATIONS_DIR, '025_memory_feedback.sql'), 'utf-8');

const AGENT_A = 'agent-aaa';
const AGENT_B = 'agent-bbb';

function createTestMemory(agentId: string, l0: string): MemoryUnit {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId,
    category: 'profile',
    mergeType: 'merge',
    mergeKey: `profile:${l0.slice(0, 16)}`,
    l0Index: l0,
    l1Overview: `${l0} 的概览`,
    l2Content: `${l0} 的完整内容`,
    confidence: 0.8,
    activation: 1.0,
    accessCount: 0,
    visibility: 'private',
    sourceConversationId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

describe('MemoryFeedbackStore', () => {
  let store: SqliteStore;
  let memoryStore: MemoryStore;
  let feedbackStore: MemoryFeedbackStore;
  let tmpDir: string;
  let memId: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-feedback-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    store.exec(MIGRATION_025);

    // 插入两个 Agent + 一条记忆作为反馈目标
    for (const id of [AGENT_A, AGENT_B]) {
      store.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, id, id, '🤖', 'active');
    }
    memoryStore = new MemoryStore(store);
    const m = createTestMemory(AGENT_A, '用户偏好简洁回答');
    memoryStore.insert(m);
    memId = m.id;

    feedbackStore = new MemoryFeedbackStore(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- insert + getById ----------

  it('insert 应返回完整的反馈记录', () => {
    const fb = feedbackStore.insert({
      memoryId: memId,
      agentId: AGENT_A,
      type: 'inaccurate',
      note: '这条记忆和用户实际偏好不符',
    });

    expect(fb.id).toBeTruthy();
    expect(fb.memoryId).toBe(memId);
    expect(fb.agentId).toBe(AGENT_A);
    expect(fb.type).toBe('inaccurate');
    expect(fb.note).toBe('这条记忆和用户实际偏好不符');
    expect(fb.reportedAt).toBeTruthy();
    expect(fb.resolvedAt).toBeNull();
  });

  it('insert 时 note 可省略', () => {
    const fb = feedbackStore.insert({
      memoryId: memId,
      agentId: AGENT_A,
      type: 'sensitive',
    });
    expect(fb.note).toBeNull();
  });

  it('getById 应能取回 insert 写入的记录', () => {
    const inserted = feedbackStore.insert({
      memoryId: memId,
      agentId: AGENT_A,
      type: 'outdated',
      note: '旧信息',
    });
    const fetched = feedbackStore.getById(inserted.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(inserted.id);
    expect(fetched!.type).toBe('outdated');
    expect(fetched!.note).toBe('旧信息');
  });

  it('getById 不存在的 id 应返回 null', () => {
    expect(feedbackStore.getById('nonexistent')).toBeNull();
  });

  it('CHECK 约束应拒绝非法 type', () => {
    expect(() => feedbackStore.insert({
      memoryId: memId,
      agentId: AGENT_A,
      type: 'bogus' as any,
    })).toThrow();
  });

  // ---------- listByMemory ----------

  it('listByMemory 应返回某条记忆的全部反馈，按时间倒序', () => {
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'outdated' });
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'sensitive' });

    const list = feedbackStore.listByMemory(memId);
    expect(list).toHaveLength(3);
    // 倒序：最新的在前
    expect(list[0].type).toBe('sensitive');
    expect(list[2].type).toBe('inaccurate');
  });

  it('listByMemory 不应跨记忆泄露', () => {
    const m2 = createTestMemory(AGENT_A, '另一条记忆');
    memoryStore.insert(m2);

    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    feedbackStore.insert({ memoryId: m2.id, agentId: AGENT_A, type: 'sensitive' });

    expect(feedbackStore.listByMemory(memId)).toHaveLength(1);
    expect(feedbackStore.listByMemory(m2.id)).toHaveLength(1);
  });

  // ---------- listUnresolvedByAgent ----------

  it('listUnresolvedByAgent 只返回未解决的反馈', () => {
    const fb1 = feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'outdated' });

    feedbackStore.markResolved(fb1.id);

    const list = feedbackStore.listUnresolvedByAgent(AGENT_A);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('outdated');
  });

  it('listUnresolvedByAgent 不应跨 Agent 泄露', () => {
    const m2 = createTestMemory(AGENT_B, 'B 的记忆');
    memoryStore.insert(m2);
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    feedbackStore.insert({ memoryId: m2.id, agentId: AGENT_B, type: 'sensitive' });

    expect(feedbackStore.listUnresolvedByAgent(AGENT_A)).toHaveLength(1);
    expect(feedbackStore.listUnresolvedByAgent(AGENT_B)).toHaveLength(1);
  });

  it('listUnresolvedByAgent 支持 limit 参数', () => {
    for (let i = 0; i < 5; i++) {
      feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    }
    expect(feedbackStore.listUnresolvedByAgent(AGENT_A, 3)).toHaveLength(3);
  });

  // ---------- listByAgent ----------

  it('listByAgent 返回 Agent 全部反馈含已解决', () => {
    const fb1 = feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'outdated' });
    feedbackStore.markResolved(fb1.id);

    const all = feedbackStore.listByAgent(AGENT_A);
    expect(all).toHaveLength(2);
  });

  it('listByAgent 支持 limit + offset 分页', () => {
    for (let i = 0; i < 5; i++) {
      feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    }
    expect(feedbackStore.listByAgent(AGENT_A, 2, 0)).toHaveLength(2);
    expect(feedbackStore.listByAgent(AGENT_A, 2, 2)).toHaveLength(2);
    expect(feedbackStore.listByAgent(AGENT_A, 2, 4)).toHaveLength(1);
  });

  // ---------- markResolved ----------

  it('markResolved 应填充 resolved_at', () => {
    const fb = feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    expect(fb.resolvedAt).toBeNull();

    feedbackStore.markResolved(fb.id);
    const after = feedbackStore.getById(fb.id);
    expect(after!.resolvedAt).not.toBeNull();
  });

  // ---------- delete ----------

  it('delete 应物理删除', () => {
    const fb = feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    feedbackStore.delete(fb.id);
    expect(feedbackStore.getById(fb.id)).toBeNull();
  });

  // ---------- 级联删除（外键）----------

  it('删除 memory_units 行应级联删除关联反馈', () => {
    feedbackStore.insert({ memoryId: memId, agentId: AGENT_A, type: 'inaccurate' });
    expect(feedbackStore.listByMemory(memId)).toHaveLength(1);

    // 物理删除记忆单元（archive 是软删，不会触发级联）
    store.run(`DELETE FROM memory_units WHERE id = ?`, memId);
    expect(feedbackStore.listByMemory(memId)).toHaveLength(0);
  });

  // ---------- CONFIDENCE_DECAY_STEP 常量 ----------

  it('CONFIDENCE_DECAY_STEP 应导出为 0.15', () => {
    expect(CONFIDENCE_DECAY_STEP).toBe(0.15);
  });
});
