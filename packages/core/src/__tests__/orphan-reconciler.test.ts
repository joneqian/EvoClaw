import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { reconcileOrphans } from '../agent/orphan-reconciler.js';

const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const INITIAL_SQL = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');

interface Fixture {
  tmpDir: string;
  agentsBaseDir: string;
  store: SqliteStore;
  realUuid: string;
  freshUuid: string;
  staleUuid: string;
}

function setUuidMtime(absPath: string, mtimeMs: number): void {
  const time = mtimeMs / 1000;
  fs.utimesSync(absPath, time, time);
  // 父目录的 mtime 不影响 reconciler 判断（reconciler 看 stat + 内部文件 mtime）
}

function setupFixture(): Fixture {
  const tmpDir = path.join(os.tmpdir(), `evoclaw-orphan-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const agentsBaseDir = path.join(tmpDir, 'agents');
  fs.mkdirSync(agentsBaseDir, { recursive: true });

  const store = new SqliteStore(path.join(tmpDir, 't.db'));
  store.exec(INITIAL_SQL);

  const realUuid = crypto.randomUUID();
  const freshUuid = crypto.randomUUID();
  const staleUuid = crypto.randomUUID();

  // 真身：有 DB 记录 + 工作区
  store.run(
    'INSERT INTO agents (id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    realUuid, 'Real', 'active', '{}', new Date().toISOString(), new Date().toISOString(),
  );
  fs.mkdirSync(path.join(agentsBaseDir, realUuid, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(agentsBaseDir, realUuid, 'workspace', 'SOUL.md'), 'real');

  // 影子 1：刚刚创建（< 24h，宽限期内）→ 应只被记录不被隔离
  const freshDir = path.join(agentsBaseDir, freshUuid, 'workspace');
  fs.mkdirSync(freshDir, { recursive: true });
  fs.writeFileSync(path.join(freshDir, 'fresh.md'), 'fresh content');

  // 影子 2：48h 前（超过宽限期）→ 应被隔离
  const staleDir = path.join(agentsBaseDir, staleUuid, 'workspace');
  fs.mkdirSync(staleDir, { recursive: true });
  const staleFile = path.join(staleDir, 'stale.md');
  fs.writeFileSync(staleFile, 'stale content');
  const twoDaysAgo = Date.now() - 48 * 3600 * 1000;
  setUuidMtime(staleFile, twoDaysAgo);
  setUuidMtime(staleDir, twoDaysAgo);
  setUuidMtime(path.join(agentsBaseDir, staleUuid), twoDaysAgo);

  return { tmpDir, agentsBaseDir, store, realUuid, freshUuid, staleUuid };
}

function cleanup(f: Fixture): void {
  f.store.close();
  fs.rmSync(f.tmpDir, { recursive: true, force: true });
}

describe('reconcileOrphans', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    cleanup(fixture);
  });

  it('skips real agent dirs', () => {
    const report = reconcileOrphans(fixture.store, fixture.agentsBaseDir);
    const realHit = report.orphans.find(o => o.uuid === fixture.realUuid);
    expect(realHit).toBeUndefined();
    // 真身目录原地不动
    expect(fs.existsSync(path.join(fixture.agentsBaseDir, fixture.realUuid))).toBe(true);
  });

  it('records fresh orphan but does NOT isolate (< 24h grace)', () => {
    const report = reconcileOrphans(fixture.store, fixture.agentsBaseDir);
    const freshHit = report.skippedFresh.find(o => o.uuid === fixture.freshUuid);
    expect(freshHit).toBeDefined();
    // 仍然在原位置
    expect(fs.existsSync(path.join(fixture.agentsBaseDir, fixture.freshUuid))).toBe(true);
    // fresh 自己没有被搬到 _orphan（搬过去的 dir 名形如 <uuid>-<ts>）
    const orphanRoot = path.join(fixture.agentsBaseDir, '_orphan');
    if (fs.existsSync(orphanRoot)) {
      const moved = fs.readdirSync(orphanRoot).filter(n => n.startsWith(fixture.freshUuid));
      expect(moved.length).toBe(0);
    }
  });

  it('isolates stale orphan (>= 24h)', () => {
    const report = reconcileOrphans(fixture.store, fixture.agentsBaseDir);
    const staleHit = report.isolated.find(i => i.uuid === fixture.staleUuid);
    expect(staleHit).toBeDefined();
    expect(staleHit!.isolatedTo).toContain('_orphan');

    // 原路径已不存在
    expect(fs.existsSync(path.join(fixture.agentsBaseDir, fixture.staleUuid))).toBe(false);
    // 隔离目录存在 + 含 manifest
    expect(fs.existsSync(staleHit!.isolatedTo)).toBe(true);
    expect(fs.existsSync(path.join(staleHit!.isolatedTo, '_orphan_manifest.json'))).toBe(true);
    // 旧文件被一并搬走
    expect(fs.existsSync(path.join(staleHit!.isolatedTo, 'workspace', 'stale.md'))).toBe(true);

    // manifest 内容可解析
    const manifest = JSON.parse(
      fs.readFileSync(path.join(staleHit!.isolatedTo, '_orphan_manifest.json'), 'utf-8'),
    );
    expect(manifest.uuid).toBe(fixture.staleUuid);
    expect(manifest.fileCount).toBeGreaterThan(0);
    expect(manifest.sample).toContain(path.join('workspace', 'stale.md'));
  });

  it('writes audit_log entry on isolation', () => {
    reconcileOrphans(fixture.store, fixture.agentsBaseDir);
    const rows = fixture.store.all<{ action: string; details: string }>(
      'SELECT action, details FROM audit_log WHERE action = ?',
      'orphan_isolated',
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const details = JSON.parse(rows[0].details);
    expect(details.uuid).toBe(fixture.staleUuid);
    expect(details.fileCount).toBeGreaterThan(0);
  });

  it('dryRun does not move files or write audit', () => {
    const report = reconcileOrphans(fixture.store, fixture.agentsBaseDir, { dryRun: true });
    const staleHit = report.isolated.find(i => i.uuid === fixture.staleUuid);
    expect(staleHit).toBeDefined();
    expect(staleHit!.isolatedTo).toBe('<dry-run>');
    // 磁盘未动
    expect(fs.existsSync(path.join(fixture.agentsBaseDir, fixture.staleUuid))).toBe(true);
    expect(fs.existsSync(path.join(fixture.agentsBaseDir, '_orphan'))).toBe(false);
    // audit_log 无新记录
    const rows = fixture.store.all<{ action: string }>(
      'SELECT action FROM audit_log WHERE action = ?',
      'orphan_isolated',
    );
    expect(rows.length).toBe(0);
  });

  it('skips management dirs (_orphan, by-name)', () => {
    fs.mkdirSync(path.join(fixture.agentsBaseDir, '_orphan', 'something'), { recursive: true });
    fs.mkdirSync(path.join(fixture.agentsBaseDir, 'by-name', 'foo'), { recursive: true });
    const report = reconcileOrphans(fixture.store, fixture.agentsBaseDir);
    expect(report.orphans.find(o => o.uuid === '_orphan')).toBeUndefined();
    expect(report.orphans.find(o => o.uuid === 'by-name')).toBeUndefined();
  });

  it('handles missing agentsBaseDir gracefully', () => {
    const report = reconcileOrphans(
      fixture.store,
      path.join(fixture.tmpDir, 'does-not-exist'),
    );
    expect(report.scanned).toBe(0);
    expect(report.orphans).toEqual([]);
  });

  it('grace period override (test convenience)', () => {
    // 把宽限期调小到 0 → 影子 freshUuid 也应被隔离
    const report = reconcileOrphans(
      fixture.store,
      fixture.agentsBaseDir,
      { freshGraceMs: 0 },
    );
    const freshHit = report.isolated.find(i => i.uuid === fixture.freshUuid);
    expect(freshHit).toBeDefined();
  });
});
