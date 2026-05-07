/**
 * curator REST routes 端到端测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Hono } from 'hono';
import { createCuratorRoutes } from '../../routes/curator.js';
import {
  upsertManifestEntry,
  computeSkillHash,
  type SkillManifestSource,
} from '../../skill/skill-manifest.js';
import {
  setState,
  setPinned,
} from '../../skill/skill-curator-lifecycle.js';
import {
  updateCuratorState,
} from '../../skill/skill-curator-state.js';

function plantSkill(
  baseDir: string,
  name: string,
  source: SkillManifestSource,
  createdAtIso?: string,
): void {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: t\n---\nbody`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
  upsertManifestEntry(baseDir, {
    name, sha256: computeSkillHash(content),
    source, createdAt: createdAtIso ?? new Date().toISOString(),
  });
}

describe('curator routes', () => {
  let tmpDir: string;
  let app: Hono;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-routes-'));
    app = new Hono();
    app.route('/curator', createCuratorRoutes({ userSkillsDir: tmpDir, intervalDays: 7 }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── GET /status ─────────────────────────────────────────────────────

  describe('GET /status', () => {
    it('空仓库返回默认值', async () => {
      const res = await app.request('/curator/status');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.state.lastRunAt).toBeNull();
      expect(body.state.runCount).toBe(0);
      expect(body.state.paused).toBe(false);
      expect(body.nextRun.shouldRun).toBe(true); // first-run
      expect(body.intervalDays).toBe(7);
    });

    it('skillsBySource 计数正确', async () => {
      plantSkill(tmpDir, 'a', 'bundled');
      plantSkill(tmpDir, 'b', 'agent-created');
      plantSkill(tmpDir, 'c', 'agent-created');
      plantSkill(tmpDir, 'd', 'clawhub');
      plantSkill(tmpDir, 'e', 'github');

      const res = await app.request('/curator/status');
      const body = await res.json() as any;
      expect(body.skillsBySource.bundled).toBe(1);
      expect(body.skillsBySource['agent-created']).toBe(2);
      expect(body.skillsBySource.clawhub).toBe(1);
      expect(body.skillsBySource.github).toBe(1);
    });

    it('agentCreatedStateCounts 反映 lifecycle', async () => {
      plantSkill(tmpDir, 'active1', 'agent-created');
      plantSkill(tmpDir, 'stale1', 'agent-created');
      plantSkill(tmpDir, 'archived1', 'agent-created');
      plantSkill(tmpDir, 'pinned1', 'agent-created');
      plantSkill(tmpDir, 'bundled-noise', 'bundled'); // 不应进入计数
      setState('stale1', 'stale', tmpDir);
      setState('archived1', 'archived', tmpDir);
      setPinned('pinned1', true, tmpDir);

      const res = await app.request('/curator/status');
      const body = await res.json() as any;
      expect(body.agentCreatedStateCounts.active).toBe(2); // active1 + pinned1（默认 active）
      expect(body.agentCreatedStateCounts.stale).toBe(1);
      expect(body.agentCreatedStateCounts.archived).toBe(1);
      expect(body.pinnedCount).toBe(1);
    });

    it('paused 状态影响 nextRun', async () => {
      updateCuratorState({ paused: true }, tmpDir);
      const res = await app.request('/curator/status');
      const body = await res.json() as any;
      expect(body.state.paused).toBe(true);
      expect(body.nextRun.shouldRun).toBe(false);
      expect(body.nextRun.reason).toBe('paused');
    });
  });

  // ─── /pause / /resume ────────────────────────────────────────────────

  describe('POST /pause + /resume', () => {
    it('pause 设为 true，resume 设为 false', async () => {
      let res = await app.request('/curator/pause', { method: 'POST' });
      expect(res.status).toBe(200);
      let body = await res.json() as any;
      expect(body.paused).toBe(true);

      res = await app.request('/curator/resume', { method: 'POST' });
      expect(res.status).toBe(200);
      body = await res.json() as any;
      expect(body.paused).toBe(false);
    });

    it('幂等：连续 pause 仍 ok', async () => {
      await app.request('/curator/pause', { method: 'POST' });
      const res = await app.request('/curator/pause', { method: 'POST' });
      const body = await res.json() as any;
      expect(body.paused).toBe(true);
    });
  });

  // ─── /archive/:name ──────────────────────────────────────────────────

  describe('POST /archive/:name', () => {
    it('agent-created skill 成功归档', async () => {
      plantSkill(tmpDir, 'mySkill', 'agent-created');
      const res = await app.request('/curator/archive/mySkill', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.archivedPath).toContain('.archive');
      expect(fs.existsSync(path.join(tmpDir, 'mySkill'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.archive', 'mySkill'))).toBe(true);
    });

    it('bundled skill 拒绝归档（403）', async () => {
      plantSkill(tmpDir, 'arxiv', 'bundled');
      const res = await app.request('/curator/archive/arxiv', { method: 'POST' });
      expect(res.status).toBe(403);
      const body = await res.json() as any;
      expect(body.error).toMatch(/source=bundled/);
    });

    it('clawhub skill 拒绝归档', async () => {
      plantSkill(tmpDir, 'web-search', 'clawhub');
      const res = await app.request('/curator/archive/web-search', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('local skill 拒绝归档', async () => {
      plantSkill(tmpDir, 'user-skill', 'local');
      const res = await app.request('/curator/archive/user-skill', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('manifest 中不存在 → 404', async () => {
      const res = await app.request('/curator/archive/no-such', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('pinned skill 拒绝归档（400）', async () => {
      plantSkill(tmpDir, 'pinned-skill', 'agent-created');
      setPinned('pinned-skill', true, tmpDir);
      const res = await app.request('/curator/archive/pinned-skill', { method: 'POST' });
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toMatch(/pinned/);
    });
  });

  // ─── /restore/:name ──────────────────────────────────────────────────

  describe('POST /restore/:name', () => {
    it('恢复已归档的 skill', async () => {
      plantSkill(tmpDir, 'rs', 'agent-created');
      // archive 一下
      await app.request('/curator/archive/rs', { method: 'POST' });
      expect(fs.existsSync(path.join(tmpDir, 'rs'))).toBe(false);

      const res = await app.request('/curator/restore/rs', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'rs'))).toBe(true);
    });

    it('原位已存在同名 → 400 拒绝', async () => {
      plantSkill(tmpDir, 'existing', 'agent-created');
      // archive
      await app.request('/curator/archive/existing', { method: 'POST' });
      // 再创建同名
      plantSkill(tmpDir, 'existing', 'agent-created');
      const res = await app.request('/curator/restore/existing', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  // ─── /prune ──────────────────────────────────────────────────────────

  describe('POST /prune', () => {
    const OLD_DATE = '2025-01-01T00:00:00Z';   // 远早于 now
    const RECENT_DATE = new Date().toISOString();

    it('default days=90，归档老的 agent-created', async () => {
      plantSkill(tmpDir, 'old1', 'agent-created', OLD_DATE);
      plantSkill(tmpDir, 'old2', 'agent-created', OLD_DATE);
      plantSkill(tmpDir, 'fresh', 'agent-created', RECENT_DATE);

      const res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json() as any;
      expect(body.archived.map((e: any) => e.name).sort()).toEqual(['old1', 'old2']);
      expect(body.count).toBe(2);
      expect(fs.existsSync(path.join(tmpDir, 'old1'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'fresh'))).toBe(true);
    });

    it('dryRun 不实际归档', async () => {
      plantSkill(tmpDir, 'old1', 'agent-created', OLD_DATE);

      const res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json() as any;
      expect(body.dryRun).toBe(true);
      expect(body.wouldArchive).toHaveLength(1);
      expect(body.wouldArchive[0].name).toBe('old1');
      expect(fs.existsSync(path.join(tmpDir, 'old1'))).toBe(true); // 仍在
    });

    it('自定义 days', async () => {
      const someDate = new Date(Date.now() - 10 * 86400_000).toISOString(); // 10 天前
      plantSkill(tmpDir, 'midage', 'agent-created', someDate);

      // days=30 不归档
      let res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30, dryRun: true }),
      });
      let body = await res.json() as any;
      expect(body.wouldArchive).toHaveLength(0);

      // days=5 应归档
      res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 5, dryRun: true }),
      });
      body = await res.json() as any;
      expect(body.wouldArchive).toHaveLength(1);
    });

    it('bundled / clawhub / github / local 永远不被 prune 选中', async () => {
      plantSkill(tmpDir, 'b1', 'bundled', OLD_DATE);
      plantSkill(tmpDir, 'h1', 'clawhub', OLD_DATE);
      plantSkill(tmpDir, 'g1', 'github', OLD_DATE);
      plantSkill(tmpDir, 'u1', 'local', OLD_DATE);

      const res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json() as any;
      expect(body.wouldArchive).toHaveLength(0);
    });

    it('pinned skill 不归档', async () => {
      plantSkill(tmpDir, 'pin1', 'agent-created', OLD_DATE);
      setPinned('pin1', true, tmpDir);

      const res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json() as any;
      expect(body.wouldArchive).toHaveLength(0);
    });

    it('已 archived 的 skill 不再次入选', async () => {
      plantSkill(tmpDir, 'arch1', 'agent-created', OLD_DATE);
      setState('arch1', 'archived', tmpDir);

      const res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const body = await res.json() as any;
      expect(body.wouldArchive).toHaveLength(0);
    });

    it('days < 1 → 400', async () => {
      const res = await app.request('/curator/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 0 }),
      });
      expect(res.status).toBe(400);
    });

    it('空 body 用默认值', async () => {
      const res = await app.request('/curator/prune', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });
});
