/**
 * Checkpoint REST 路由集成测试
 *
 * 端到端：起 Hono router → 喂请求 → 验证 JSON 响应 + 实际副作用
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { CheckpointStore } from '../../agent/checkpoint/checkpoint-store.js';
import { CheckpointManager } from '../../agent/checkpoint/checkpoint-manager.js';
import { createCheckpointRoutes } from '../../routes/checkpoint.js';

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../infrastructure/db/migrations/039_checkpoint_log.sql'),
  'utf-8',
);

describe('checkpoint routes', () => {
  let tempDir: string;
  let db: SqliteStore;
  let manager: CheckpointManager;
  let app: Hono;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoclaw-cpr-'));
    db = new SqliteStore(path.join(tempDir, 'test.db'));
    db.exec(MIGRATION_SQL);
    manager = new CheckpointManager(db, {
      store: new CheckpointStore(path.join(tempDir, 'cps')),
    });
    app = new Hono();
    app.route('/checkpoint', createCheckpointRoutes({ manager }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string): string {
    const p = path.join(tempDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  it('GET /checkpoint/recent 空表返回空数组', async () => {
    const res = await app.request('/checkpoint/recent');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('GET /checkpoint/recent 返回最近 N 条按 createdAt 倒序', async () => {
    const a = writeFile('a.txt', 'A');
    const b = writeFile('b.txt', 'B');
    await manager.create({ toolInvocationId: 'inv-1', toolName: 'edit', filePaths: [a] });
    await new Promise((r) => setTimeout(r, 5));
    await manager.create({ toolInvocationId: 'inv-2', toolName: 'write', filePaths: [b] });

    const res = await app.request('/checkpoint/recent?limit=10');
    const body = (await res.json()) as {
      data: Array<{ toolInvocationId: string }>;
    };
    expect(body.data.map((r) => r.toolInvocationId)).toEqual(['inv-2', 'inv-1']);
  });

  it('GET /checkpoint/recent limit 参数被截断到 [1, 200]', async () => {
    const res1 = await app.request('/checkpoint/recent?limit=99999');
    expect(res1.status).toBe(200); // 不抛错（在 [1,200] 内截断）

    const res2 = await app.request('/checkpoint/recent?limit=-5');
    expect(res2.status).toBe(200);

    const res3 = await app.request('/checkpoint/recent?limit=abc');
    expect(res3.status).toBe(200); // NaN 时降级 50
  });

  it('GET /checkpoint/:id 返回单条详情', async () => {
    const f = writeFile('a.txt', 'A');
    await manager.create({ toolInvocationId: 'inv-x', toolName: 'edit', filePaths: [f] });
    const res = await app.request('/checkpoint/inv-x');
    const body = (await res.json()) as {
      success: boolean;
      data: { toolInvocationId: string; files: Array<{ path: string }> };
    };
    expect(body.success).toBe(true);
    expect(body.data.toolInvocationId).toBe('inv-x');
    expect(body.data.files[0]!.path).toBe(f);
  });

  it('GET /checkpoint/:id 不存在返回 404', async () => {
    const res = await app.request('/checkpoint/missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('POST /checkpoint/:id/revert 还原文件', async () => {
    const f = writeFile('a.txt', 'original');
    await manager.create({ toolInvocationId: 'inv-r', toolName: 'edit', filePaths: [f] });
    fs.writeFileSync(f, 'broken', 'utf-8');

    const res = await app.request('/checkpoint/inv-r/revert', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; restored: number };
    expect(body.success).toBe(true);
    expect(body.restored).toBe(1);
    expect(fs.readFileSync(f, 'utf-8')).toBe('original');
  });

  it('POST /checkpoint/:id/revert 不存在返回 404', async () => {
    const res = await app.request('/checkpoint/missing/revert', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /checkpoint/gc 默认 7 天保留', async () => {
    // 创建一条然后手动 reverted_at = 8 天前
    const f = writeFile('a.txt', 'A');
    await manager.create({ toolInvocationId: 'inv-old', toolName: 'edit', filePaths: [f] });
    await manager.revert('inv-old');
    db.run(
      `UPDATE checkpoint_log SET reverted_at = ? WHERE tool_invocation_id = ?`,
      Date.now() - 8 * 24 * 60 * 60 * 1000,
      'inv-old',
    );

    const res = await app.request('/checkpoint/gc', { method: 'POST' });
    const body = (await res.json()) as { success: boolean; deletedRefs: number };
    expect(body.success).toBe(true);
    expect(body.deletedRefs).toBe(1);
  });

  it('POST /checkpoint/gc 接受 retentionDays body 自定义阈值', async () => {
    const f = writeFile('a.txt', 'A');
    await manager.create({ toolInvocationId: 'inv-1d', toolName: 'edit', filePaths: [f] });
    await manager.revert('inv-1d');
    db.run(
      `UPDATE checkpoint_log SET reverted_at = ? WHERE tool_invocation_id = ?`,
      Date.now() - 2 * 24 * 60 * 60 * 1000,
      'inv-1d',
    );

    const res = await app.request('/checkpoint/gc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: 1 }),
    });
    const body = (await res.json()) as { success: boolean; deletedRefs: number };
    expect(body.deletedRefs).toBe(1);
  });
});
