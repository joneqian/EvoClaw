import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryStore } from '../memory/memory-store.js';
import { MergeResolver } from '../memory/merge-resolver.js';
import type { ParsedMemory } from '../memory/xml-parser.js';

/** 读取迁移 SQL（001 + 002） */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8'
);
const MIGRATION_002 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '002_memory_units.sql'),
  'utf-8'
);

/** 创建测试用 Agent 记录 */
function insertTestAgent(store: SqliteStore, agentId: string): void {
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
    agentId, '测试助手', '🤖', 'active', '{}',
  );
}

/** 构建 independent 类型的 ParsedMemory */
function makeIndependentMemory(overrides?: Partial<ParsedMemory>): ParsedMemory {
  return {
    category: 'event',
    mergeType: 'independent',
    mergeKey: null,
    l0Index: '用户参加了技术会议',
    l1Overview: '用户于 2026 年参加了一场关于 AI 的技术会议',
    l2Content: '用户提到自己参加了 2026 年 3 月在深圳举办的 AI 技术大会，会上讨论了 LLM 的最新进展。',
    confidence: 0.8,
    ...overrides,
  };
}

/** 构建 merge 类型的 ParsedMemory */
function makeMergeMemory(mergeKey: string, overrides?: Partial<ParsedMemory>): ParsedMemory {
  return {
    category: 'preference',
    mergeType: 'merge',
    mergeKey,
    l0Index: '用户偏好 TypeScript strict 模式',
    l1Overview: '用户在编码时偏好使用 TypeScript 的严格模式',
    l2Content: '用户表达了对 TypeScript strict 模式的偏好，要求所有变量有明确类型声明。',
    confidence: 0.9,
    ...overrides,
  };
}

describe('MergeResolver', () => {
  let store: SqliteStore;
  let memoryStore: MemoryStore;
  let resolver: MergeResolver;
  let tmpDir: string;
  const agentId = 'agent-merge-test-001';

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-merge-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    insertTestAgent(store, agentId);

    memoryStore = new MemoryStore(store);
    resolver = new MergeResolver(memoryStore);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('independent 类型始终创建新记录', () => {
    const parsed = makeIndependentMemory();

    const id1 = resolver.resolve(agentId, parsed);
    const id2 = resolver.resolve(agentId, parsed);

    // 两次调用应生成不同的 ID
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);

    // 数据库中应有两条记录
    const units = memoryStore.listByAgent(agentId);
    expect(units).toHaveLength(2);
  });

  it('merge 类型 + 新 mergeKey 应创建新记录', () => {
    const parsed = makeMergeMemory('preference:new_topic');

    const id = resolver.resolve(agentId, parsed);

    expect(id).toBeTruthy();
    const unit = memoryStore.getById(id);
    expect(unit).not.toBeNull();
    expect(unit!.mergeKey).toBe('preference:new_topic');
    expect(unit!.l1Overview).toBe(parsed.l1Overview);
  });

  it('merge 类型 + 已有 mergeKey 应更新 L1/L2 但保持 L0 不变', () => {
    const original = makeMergeMemory('preference:coding_style');
    const originalId = resolver.resolve(agentId, original);

    // 获取原始 L0 值
    const originalUnit = memoryStore.getById(originalId)!;
    const originalL0 = originalUnit.l0Index;

    // 用相同 mergeKey 再次 resolve，更新 L1/L2
    const updated = makeMergeMemory('preference:coding_style', {
      l1Overview: '更新后的 L1 概览',
      l2Content: '更新后的 L2 完整内容',
    });
    const updatedId = resolver.resolve(agentId, updated);

    // 应返回相同的 ID（合并更新）
    expect(updatedId).toBe(originalId);

    // 验证 L0 未变，L1/L2 已更新
    const mergedUnit = memoryStore.getById(updatedId)!;
    expect(mergedUnit.l0Index).toBe(originalL0);
    expect(mergedUnit.l1Overview).toBe('更新后的 L1 概览');
    expect(mergedUnit.l2Content).toBe('更新后的 L2 完整内容');
  });

  it('merge 类型合并时应提升 activation', () => {
    const parsed = makeMergeMemory('preference:editor');
    const id = resolver.resolve(agentId, parsed);

    // 首次创建时 activation = 1.0
    const beforeUnit = memoryStore.getById(id)!;
    expect(beforeUnit.activation).toBe(1.0);

    // 再次合并同一 mergeKey
    resolver.resolve(agentId, makeMergeMemory('preference:editor', {
      l1Overview: '更新后的编辑器偏好',
    }));

    // bumpActivation 应将 activation += 0.1
    const afterUnit = memoryStore.getById(id)!;
    expect(afterUnit.activation).toBeGreaterThan(beforeUnit.activation);
    expect(afterUnit.accessCount).toBe(beforeUnit.accessCount + 1);
  });

  it('resolveAll 应批量处理多条 ParsedMemory', () => {
    const memories: ParsedMemory[] = [
      makeIndependentMemory({ l0Index: '事件一' }),
      makeMergeMemory('preference:language', { l0Index: '偏好中文' }),
      makeIndependentMemory({ l0Index: '事件二' }),
    ];

    const ids = resolver.resolveAll(agentId, memories);

    expect(ids).toHaveLength(3);
    // 所有 ID 都应唯一
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);

    // 数据库中应有 3 条记录
    const units = memoryStore.listByAgent(agentId);
    expect(units).toHaveLength(3);
  });

  it('多条 independent 类型 + 相同 category 应创建独立记录', () => {
    const memories: ParsedMemory[] = [
      makeIndependentMemory({ category: 'event', l0Index: '会议 A' }),
      makeIndependentMemory({ category: 'event', l0Index: '会议 B' }),
      makeIndependentMemory({ category: 'event', l0Index: '会议 C' }),
    ];

    const ids = resolver.resolveAll(agentId, memories);

    // 即使 category 相同，每条都是独立记录
    expect(ids).toHaveLength(3);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);

    // 按 category 过滤也应有 3 条
    const events = memoryStore.listByAgent(agentId, { category: 'event' });
    expect(events).toHaveLength(3);
  });
});
