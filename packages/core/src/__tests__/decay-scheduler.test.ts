import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { DecayScheduler } from '../memory/decay-scheduler.js';
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
const TEST_AGENT_ID = 'test-agent-decay-001';

/** 创建测试记忆单元 */
function createTestUnit(overrides: Partial<MemoryUnit> = {}): MemoryUnit {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: TEST_AGENT_ID,
    category: 'entity',
    mergeType: 'independent',
    mergeKey: null,
    l0Index: '测试记忆',
    l1Overview: '测试概览',
    l2Content: '测试完整内容',
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

/** 将 MemoryUnit 插入数据库（直接写入 snake_case 列） */
function insertMemory(store: SqliteStore, unit: MemoryUnit): void {
  store.run(
    `INSERT INTO memory_units (
      id, agent_id, category, merge_type, merge_key,
      l0_index, l1_overview, l2_content,
      confidence, activation, access_count,
      visibility, source_session_key,
      created_at, updated_at, archived_at, pinned, last_access_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    unit.id, unit.agentId, unit.category, unit.mergeType, unit.mergeKey,
    unit.l0Index, unit.l1Overview, unit.l2Content,
    unit.confidence, unit.activation, unit.accessCount,
    unit.visibility, unit.sourceConversationId,
    unit.createdAt, unit.updatedAt, unit.archivedAt,
    0, // pinned
    null, // last_access_at
  );
}

/** 生成 N 天前的 ISO 时间字符串 */
function daysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

describe('DecayScheduler', () => {
  let store: SqliteStore;
  let scheduler: DecayScheduler;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-decay-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    // 执行迁移
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    // 插入测试 Agent（外键约束需要）
    store.run(
      `INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`,
      TEST_AGENT_ID, '衰减测试助手', '🧪', 'active',
    );

    // 使用较短间隔便于测试
    scheduler = new DecayScheduler(store, 100_000);
  });

  afterEach(() => {
    scheduler.stop();
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- tick: 衰减计算 ----------

  describe('tick', () => {
    it('刚创建的记忆应保持较高 activation', () => {
      // 刚创建的记忆，age ≈ 0 天
      const freshUnit = createTestUnit({
        activation: 1.0,
        accessCount: 1,
      });
      insertMemory(store, freshUnit);

      const result = scheduler.tick();
      expect(result.updated).toBe(1);
      expect(result.archived).toBe(0);

      // 检查 activation 值：刚创建时 ageDays ≈ 0，timeFactor ≈ 1
      const row = store.get<{ activation: number }>(
        'SELECT activation FROM memory_units WHERE id = ?',
        freshUnit.id,
      );
      // 新记忆的 activation 应接近 sigmoid(log1p(1)) ≈ sigmoid(0.693) ≈ 0.667
      expect(row!.activation).toBeGreaterThan(0.5);
    });

    it('久远记忆的 activation 应衰减到较低值', () => {
      // 60 天前的记忆
      const oldUnit = createTestUnit({
        activation: 1.0,
        accessCount: 1,
        updatedAt: daysAgo(60),
        createdAt: daysAgo(60),
      });
      insertMemory(store, oldUnit);

      scheduler.tick();

      const row = store.get<{ activation: number }>(
        'SELECT activation FROM memory_units WHERE id = ?',
        oldUnit.id,
      );
      // 60 天后，衰减显著，activation 应远低于初始值
      expect(row!.activation).toBeLessThan(0.1);
    });

    it('多次访问的记忆衰减后 activation 仍高于低访问记忆', () => {
      // 同样 14 天前，但不同 access_count
      const highAccess = createTestUnit({
        id: 'high-access',
        accessCount: 20,
        updatedAt: daysAgo(14),
        createdAt: daysAgo(14),
      });
      const lowAccess = createTestUnit({
        id: 'low-access',
        accessCount: 1,
        updatedAt: daysAgo(14),
        createdAt: daysAgo(14),
      });
      insertMemory(store, highAccess);
      insertMemory(store, lowAccess);

      scheduler.tick();

      const highRow = store.get<{ activation: number }>(
        'SELECT activation FROM memory_units WHERE id = ?',
        'high-access',
      );
      const lowRow = store.get<{ activation: number }>(
        'SELECT activation FROM memory_units WHERE id = ?',
        'low-access',
      );
      // 高访问次数 → sigmoid(log1p(20)) 更高
      expect(highRow!.activation).toBeGreaterThan(lowRow!.activation);
    });
  });

  // ---------- tick: 归档逻辑 ----------

  describe('tick — 归档', () => {
    it('activation < 0.1 且超过 30 天未访问的记忆应被归档', () => {
      // 90 天前创建，从未访问 → activation 极低 + last_access_at 很久
      const coldUnit = createTestUnit({
        activation: 1.0,
        accessCount: 0,
        createdAt: daysAgo(90),
        updatedAt: daysAgo(90),
      });
      insertMemory(store, coldUnit);

      const result = scheduler.tick();
      expect(result.archived).toBe(1);

      // 检查 archived_at 已被设置
      const row = store.get<{ archived_at: string | null }>(
        'SELECT archived_at FROM memory_units WHERE id = ?',
        coldUnit.id,
      );
      expect(row!.archived_at).not.toBeNull();
    });

    it('pinned 的记忆不应被衰减和归档', () => {
      // 即使很旧且低活跃，pinned 记忆不参与衰减
      const pinnedUnit = createTestUnit({
        activation: 0.05,
        accessCount: 0,
        createdAt: daysAgo(90),
        updatedAt: daysAgo(90),
      });
      insertMemory(store, pinnedUnit);
      // 标记为 pinned
      store.run('UPDATE memory_units SET pinned = 1 WHERE id = ?', pinnedUnit.id);

      const result = scheduler.tick();
      // pinned 的记忆不会被 SELECT 到（WHERE pinned = 0）
      expect(result.updated).toBe(0);
      expect(result.archived).toBe(0);

      // 确认未被归档
      const row = store.get<{ archived_at: string | null }>(
        'SELECT archived_at FROM memory_units WHERE id = ?',
        pinnedUnit.id,
      );
      expect(row!.archived_at).toBeNull();
    });

    it('activation 低但近期有访问的记忆不应被归档', () => {
      // 60 天前创建但 10 天前有访问
      const recentAccessUnit = createTestUnit({
        activation: 1.0,
        accessCount: 0,
        createdAt: daysAgo(60),
        updatedAt: daysAgo(60),
      });
      insertMemory(store, recentAccessUnit);
      // 设置 last_access_at 为 10 天前（不满足 30 天未访问条件）
      store.run(
        'UPDATE memory_units SET last_access_at = ? WHERE id = ?',
        daysAgo(10),
        recentAccessUnit.id,
      );

      const result = scheduler.tick();
      // activation 应该会低于 0.1（60 天前），但近期访问过不应归档
      expect(result.archived).toBe(0);
    });
  });

  // ---------- 生命周期: start / stop / isRunning ----------

  describe('生命周期', () => {
    it('初始状态应为未运行', () => {
      expect(scheduler.isRunning).toBe(false);
    });

    it('start 后应为运行状态', () => {
      scheduler.start();
      expect(scheduler.isRunning).toBe(true);
    });

    it('stop 后应为停止状态', () => {
      scheduler.start();
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it('重复 start 不应创建多个定时器', () => {
      scheduler.start();
      scheduler.start(); // 第二次调用应被忽略
      expect(scheduler.isRunning).toBe(true);
      scheduler.stop();
      expect(scheduler.isRunning).toBe(false);
    });

    it('未运行时 stop 不应报错', () => {
      expect(() => scheduler.stop()).not.toThrow();
    });
  });
});
