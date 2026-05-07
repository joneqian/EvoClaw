/**
 * Checkpoint Manager 集成测试
 *
 * 端到端：在临时目录跑 SqliteStore + CheckpointStore + CheckpointManager。
 * 覆盖 create / revert / listRecent / gc / 边界（不存在文件 / 已 reverted 幂等 / GC 后 revert）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { CheckpointStore } from '../../agent/checkpoint/checkpoint-store.js';
import { CheckpointManager } from '../../agent/checkpoint/checkpoint-manager.js';

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../infrastructure/db/migrations/039_checkpoint_log.sql'),
  'utf-8',
);

describe('CheckpointManager', () => {
  let tempDir: string;
  let dbPath: string;
  let storeRoot: string;
  let workspaceDir: string;
  let db: SqliteStore;
  let manager: CheckpointManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoclaw-cpm-'));
    dbPath = path.join(tempDir, 'test.db');
    storeRoot = path.join(tempDir, 'cps');
    workspaceDir = path.join(tempDir, 'ws');
    fs.mkdirSync(workspaceDir, { recursive: true });

    db = new SqliteStore(dbPath);
    db.exec(MIGRATION_SQL);

    manager = new CheckpointManager(db, {
      store: new CheckpointStore(storeRoot),
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeWs(rel: string, content: string): string {
    const p = path.join(workspaceDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  // ─── create ────────────────────────────────────────────────────────

  it('create：单文件已存在 → 写 object 并登记', async () => {
    const fpath = writeWs('a.txt', 'original');
    const record = await manager.create({
      toolInvocationId: 'inv-1',
      toolName: 'edit',
      filePaths: [fpath],
    });

    expect(record.toolInvocationId).toBe('inv-1');
    expect(record.files).toHaveLength(1);
    expect(record.files[0]!.path).toBe(fpath);
    expect(record.files[0]!.existedBefore).toBe(true);
    expect(record.files[0]!.shaBefore).toMatch(/^[a-f0-9]{64}$/);

    const dbRow = manager.get('inv-1');
    expect(dbRow?.files[0]!.shaBefore).toBe(record.files[0]!.shaBefore);
  });

  it('create：文件不存在 → existedBefore=false sentinel', async () => {
    const fpath = path.join(workspaceDir, 'new.txt');
    const record = await manager.create({
      toolInvocationId: 'inv-2',
      toolName: 'write',
      filePaths: [fpath],
    });
    expect(record.files[0]!.existedBefore).toBe(false);
  });

  it('create：多文件批量', async () => {
    const a = writeWs('a.txt', 'A');
    const b = writeWs('b.txt', 'B');
    const record = await manager.create({
      toolInvocationId: 'inv-multi',
      toolName: 'apply_patch',
      filePaths: [a, b],
    });
    expect(record.files).toHaveLength(2);
  });

  it('create：相同内容多次 → object 复用（dedup）', async () => {
    const a = writeWs('a.txt', 'samecontent');
    const b = writeWs('b.txt', 'samecontent');
    await manager.create({ toolInvocationId: 'inv-x', toolName: 'edit', filePaths: [a, b] });
    expect(manager.checkpointStore.listObjects()).toHaveLength(1);
  });

  // ─── revert ───────────────────────────────────────────────────────

  it('revert：还原已存在文件到改前内容', async () => {
    const fpath = writeWs('a.txt', 'original');
    await manager.create({ toolInvocationId: 'inv-r', toolName: 'edit', filePaths: [fpath] });
    // 模拟工具改坏文件
    fs.writeFileSync(fpath, 'BROKEN', 'utf-8');
    const restored = await manager.revert('inv-r');
    expect(restored).toBe(1);
    expect(fs.readFileSync(fpath, 'utf-8')).toBe('original');
  });

  it('revert：existedBefore=false → 删除新建的文件', async () => {
    const fpath = path.join(workspaceDir, 'new.txt');
    await manager.create({ toolInvocationId: 'inv-d', toolName: 'write', filePaths: [fpath] });
    // 工具创建了文件
    fs.writeFileSync(fpath, 'created by tool', 'utf-8');
    expect(fs.existsSync(fpath)).toBe(true);
    await manager.revert('inv-d');
    expect(fs.existsSync(fpath)).toBe(false);
  });

  it('revert：批量多文件全部还原', async () => {
    const a = writeWs('a.txt', 'A-orig');
    const b = writeWs('b.txt', 'B-orig');
    await manager.create({
      toolInvocationId: 'inv-batch',
      toolName: 'apply_patch',
      filePaths: [a, b],
    });
    fs.writeFileSync(a, 'A-broken', 'utf-8');
    fs.writeFileSync(b, 'B-broken', 'utf-8');
    const restored = await manager.revert('inv-batch');
    expect(restored).toBe(2);
    expect(fs.readFileSync(a, 'utf-8')).toBe('A-orig');
    expect(fs.readFileSync(b, 'utf-8')).toBe('B-orig');
  });

  it('revert：不存在的 invocationId 返回 -1', async () => {
    expect(await manager.revert('not-found')).toBe(-1);
  });

  it('revert：幂等 — 第二次 revert 不重复操作', async () => {
    const fpath = writeWs('a.txt', 'original');
    await manager.create({ toolInvocationId: 'inv-i', toolName: 'edit', filePaths: [fpath] });
    fs.writeFileSync(fpath, 'broken', 'utf-8');
    await manager.revert('inv-i');

    // 第二次 revert：reverted_at 已设置，直接返回不再写文件
    const beforeMtime = fs.statSync(fpath).mtimeMs;
    await new Promise((r) => setTimeout(r, 10)); // 确保 mtime 能区分
    const second = await manager.revert('inv-i');
    expect(second).toBe(1); // 返回原 files 数量
    const afterMtime = fs.statSync(fpath).mtimeMs;
    expect(afterMtime).toBe(beforeMtime); // 文件未被再次写
  });

  it('revert：object 已被 GC 时跳过该文件不抛错', async () => {
    const fpath = writeWs('a.txt', 'original');
    await manager.create({ toolInvocationId: 'inv-g', toolName: 'edit', filePaths: [fpath] });
    // 强制删 object 模拟 GC
    const record = manager.get('inv-g')!;
    manager.checkpointStore.deleteObject(record.files[0]!.shaBefore);
    fs.writeFileSync(fpath, 'broken', 'utf-8');

    const restored = await manager.revert('inv-g');
    expect(restored).toBe(0); // 跳过未还原任何文件
    // 但 reverted_at 仍被标记
    expect(manager.get('inv-g')!.revertedAt).not.toBeNull();
  });

  // ─── listRecent ───────────────────────────────────────────────────

  it('listRecent：按 createdAt 倒序', async () => {
    const a = writeWs('a.txt', 'A');
    const b = writeWs('b.txt', 'B');
    const c = writeWs('c.txt', 'C');
    await manager.create({ toolInvocationId: 'inv-1', toolName: 'edit', filePaths: [a] });
    await new Promise((r) => setTimeout(r, 5));
    await manager.create({ toolInvocationId: 'inv-2', toolName: 'edit', filePaths: [b] });
    await new Promise((r) => setTimeout(r, 5));
    await manager.create({ toolInvocationId: 'inv-3', toolName: 'edit', filePaths: [c] });

    const list = manager.listRecent(10);
    expect(list.map((r) => r.toolInvocationId)).toEqual(['inv-3', 'inv-2', 'inv-1']);
  });

  it('listRecent：limit 截断', async () => {
    for (let i = 0; i < 5; i++) {
      const f = writeWs(`f${i}.txt`, 'x');
      await manager.create({
        toolInvocationId: `inv-${i}`,
        toolName: 'edit',
        filePaths: [f],
      });
    }
    expect(manager.listRecent(3)).toHaveLength(3);
  });

  // ─── gc ──────────────────────────────────────────────────────────

  it('gc：清理 reservedDays 之前已 reverted 的 ref + 孤儿 object', async () => {
    const a = writeWs('a.txt', 'A');
    await manager.create({ toolInvocationId: 'inv-old', toolName: 'edit', filePaths: [a] });
    fs.writeFileSync(a, 'broken', 'utf-8');
    await manager.revert('inv-old');

    // 把 reverted_at 改为 8 天前
    db.run(
      `UPDATE checkpoint_log SET reverted_at = ? WHERE tool_invocation_id = ?`,
      Date.now() - 8 * 24 * 60 * 60 * 1000,
      'inv-old',
    );

    const result = await manager.gc(7 * 24 * 60 * 60 * 1000);
    expect(result.deletedRefs).toBe(1);
    expect(result.deletedObjects).toBe(1);
    expect(manager.get('inv-old')).toBeNull();
  });

  it('gc：未 reverted 的 ref 即使旧也保留（用户可能还想撤销）', async () => {
    const a = writeWs('a.txt', 'A');
    await manager.create({ toolInvocationId: 'inv-keep', toolName: 'edit', filePaths: [a] });

    // 把 created_at 改为 30 天前
    db.run(
      `UPDATE checkpoint_log SET created_at = ? WHERE tool_invocation_id = ?`,
      Date.now() - 30 * 24 * 60 * 60 * 1000,
      'inv-keep',
    );

    const result = await manager.gc(7 * 24 * 60 * 60 * 1000);
    expect(result.deletedRefs).toBe(0);
    expect(manager.get('inv-keep')).not.toBeNull();
  });

  it('gc：还在引用中的 object 不被删', async () => {
    const a = writeWs('a.txt', 'A');
    const b = writeWs('b.txt', 'B');
    await manager.create({ toolInvocationId: 'inv-1', toolName: 'edit', filePaths: [a] });
    await manager.create({ toolInvocationId: 'inv-2', toolName: 'edit', filePaths: [b] });

    const result = await manager.gc(7 * 24 * 60 * 60 * 1000);
    expect(result.deletedObjects).toBe(0);
    expect(manager.checkpointStore.listObjects()).toHaveLength(2);
  });
});
