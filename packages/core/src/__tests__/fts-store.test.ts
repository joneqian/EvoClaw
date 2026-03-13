import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { FtsStore } from '../infrastructure/db/fts-store.js';

describe('FtsStore', () => {
  let store: SqliteStore;
  let fts: FtsStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-fts-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    // FtsStore 自动创建 FTS5 虚拟表，无需迁移
    store = new SqliteStore(dbPath);
    fts = new FtsStore(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- indexMemory + search 往返 ----------

  it('indexMemory + search 应能完成索引与检索往返', () => {
    const memoryId = 'mem-001';
    fts.indexMemory(memoryId, 'TypeScript 编程', '用户擅长 TypeScript 和 React 开发');

    const results = fts.search('TypeScript');
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe(memoryId);
    // BM25 score 应为负数（rank 列）
    expect(typeof results[0].score).toBe('number');
  });

  // ---------- 中文全文搜索（unicode61 分词器） ----------

  it('search 应支持中文文本检索', () => {
    // unicode61 按 Unicode 字符边界分词，中文需用单独词条或空格分隔的词
    fts.indexMemory('mem-cn-1', '用户 偏好', '喜欢 深色 主题 简洁 界面 设计');
    fts.indexMemory('mem-cn-2', '编程 语言', '经常 使用 Python 进行 数据 分析');

    const results = fts.search('深色');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].memoryId).toBe('mem-cn-1');
  });

  // ---------- 无匹配时返回空 ----------

  it('search 对无匹配查询应返回空数组', () => {
    fts.indexMemory('mem-001', '前端开发', 'React 组件设计模式');

    const results = fts.search('量子力学');
    expect(results).toEqual([]);
  });

  // ---------- updateIndex 覆盖旧索引 ----------

  it('updateIndex 应覆盖先前的索引内容', () => {
    const memoryId = 'mem-update';
    fts.indexMemory(memoryId, 'old_title', 'old overview content');
    fts.updateIndex(memoryId, 'new_title', 'brand new overview about machine_learning');

    // 旧内容应搜索不到
    const oldResults = fts.search('old_title');
    expect(oldResults).toEqual([]);

    // 新内容应能搜索到
    const newResults = fts.search('machine_learning');
    expect(newResults.length).toBe(1);
    expect(newResults[0].memoryId).toBe(memoryId);
  });

  // ---------- removeIndex 使记忆不可搜索 ----------

  it('removeIndex 后该记忆应不再出现在搜索结果中', () => {
    const memoryId = 'mem-remove';
    fts.indexMemory(memoryId, '待删除索引', '这条记忆即将被移除');

    // 删除前可搜到
    expect(fts.search('待删除索引').length).toBe(1);

    fts.removeIndex(memoryId);

    // 删除后搜不到
    expect(fts.search('待删除索引')).toEqual([]);
  });

  // ---------- 特殊字符不导致崩溃 ----------

  it('search 包含特殊字符时不应抛出异常', () => {
    fts.indexMemory('mem-safe', '安全测试', '普通文本内容');

    // 各种特殊字符
    expect(() => fts.search("it's a \"test\"")).not.toThrow();
    expect(() => fts.search('(hello) [world] {foo}')).not.toThrow();
    expect(() => fts.search('***')).not.toThrow();
    expect(() => fts.search('a^b~c\\d')).not.toThrow();
  });

  // ---------- 空查询返回空 ----------

  it('search 传入空字符串应返回空数组', () => {
    fts.indexMemory('mem-001', '测试', '内容');

    expect(fts.search('')).toEqual([]);
    expect(fts.search('   ')).toEqual([]);
  });
});
