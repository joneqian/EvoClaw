/**
 * Skill Curator Lifecycle 单测
 *
 * 覆盖：
 * - readLifecycle / writeLifecycle 序列化往返
 * - 文件不存在 / 解析失败 → 返回空 Map（fail-soft）
 * - setState：进 archived 时打 archivedAt，离 archived 时清空
 * - setPinned 不影响 state
 * - archiveSkill：mv 物理移动 + 冲突加时间戳 + pinned 拒绝
 * - restoreSkill：精确匹配 + 前缀匹配 + 已存在拒绝
 * - deleteEntry / listLifecycleEntries
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  readLifecycle,
  writeLifecycle,
  getEntry,
  setState,
  setPinned,
  deleteEntry,
  archiveSkill,
  restoreSkill,
  listLifecycleEntries,
  type SkillLifecycleEntry,
} from '../../skill/skill-curator-lifecycle.js';

describe('skill-curator-lifecycle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-lifecycle-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── readLifecycle / writeLifecycle ─────────────────────────────────────

  describe('文件读写', () => {
    it('文件不存在时返回空 Map（fail-soft）', () => {
      const entries = readLifecycle(tmpDir);
      expect(entries.size).toBe(0);
    });

    it('write + read 往返一致', () => {
      const now = new Date().toISOString();
      const original = new Map<string, SkillLifecycleEntry>([
        ['s1', { name: 's1', state: 'active', archivedAt: null, pinned: false, updatedAt: now }],
        ['s2', { name: 's2', state: 'archived', archivedAt: now, pinned: true, updatedAt: now }],
      ]);
      writeLifecycle(original, tmpDir);

      const loaded = readLifecycle(tmpDir);
      expect(loaded.size).toBe(2);
      expect(loaded.get('s1')!.state).toBe('active');
      expect(loaded.get('s2')!.state).toBe('archived');
      expect(loaded.get('s2')!.pinned).toBe(true);
      expect(loaded.get('s2')!.archivedAt).toBe(now);
    });

    it('文件 JSON 解析失败 → 返回空 Map（fail-soft）', () => {
      const filePath = path.join(tmpDir, '.curator_lifecycle.json');
      fs.writeFileSync(filePath, 'this is not json', 'utf-8');
      const entries = readLifecycle(tmpDir);
      expect(entries.size).toBe(0);
    });

    it('文件 version 不匹配 → 返回空 Map', () => {
      const filePath = path.join(tmpDir, '.curator_lifecycle.json');
      fs.writeFileSync(filePath, JSON.stringify({ version: 99, entries: { x: { state: 'active' } } }), 'utf-8');
      const entries = readLifecycle(tmpDir);
      expect(entries.size).toBe(0);
    });

    it('entry 缺 state 字段 → 跳过该条', () => {
      const filePath = path.join(tmpDir, '.curator_lifecycle.json');
      fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        entries: {
          ok: { state: 'active', archivedAt: null, pinned: false, updatedAt: '2026-01-01T00:00:00Z' },
          bad: { archivedAt: null }, // 缺 state
        },
      }), 'utf-8');
      const entries = readLifecycle(tmpDir);
      expect(entries.size).toBe(1);
      expect(entries.has('ok')).toBe(true);
      expect(entries.has('bad')).toBe(false);
    });
  });

  // ─── getEntry / setState / setPinned ────────────────────────────────────

  describe('getEntry / setState / setPinned', () => {
    it('getEntry 不存在时返回默认 active', () => {
      const e = getEntry('new-skill', tmpDir);
      expect(e.state).toBe('active');
      expect(e.archivedAt).toBeNull();
      expect(e.pinned).toBe(false);
    });

    it('setState active → stale 持久化', () => {
      setState('s1', 'stale', tmpDir);
      const e = getEntry('s1', tmpDir);
      expect(e.state).toBe('stale');
      expect(e.archivedAt).toBeNull();
    });

    it('setState 进 archived 时打 archivedAt', () => {
      setState('s1', 'archived', tmpDir);
      const e = getEntry('s1', tmpDir);
      expect(e.state).toBe('archived');
      expect(e.archivedAt).toBeTruthy();
    });

    it('setState 离 archived 时清 archivedAt', () => {
      setState('s1', 'archived', tmpDir);
      expect(getEntry('s1', tmpDir).archivedAt).toBeTruthy();
      setState('s1', 'active', tmpDir);
      expect(getEntry('s1', tmpDir).archivedAt).toBeNull();
    });

    it('archived 状态下重复 setState archived 保留首次 archivedAt', async () => {
      setState('s1', 'archived', tmpDir);
      const ts1 = getEntry('s1', tmpDir).archivedAt;
      // 等 10ms 让时间戳有差
      await new Promise(r => setTimeout(r, 10));
      setState('s1', 'archived', tmpDir);
      const ts2 = getEntry('s1', tmpDir).archivedAt;
      expect(ts2).toBe(ts1);
    });

    it('setPinned 不改 state', () => {
      setState('s1', 'stale', tmpDir);
      setPinned('s1', true, tmpDir);
      const e = getEntry('s1', tmpDir);
      expect(e.state).toBe('stale');
      expect(e.pinned).toBe(true);
    });

    it('setPinned false 默认值即可', () => {
      setPinned('s1', true, tmpDir);
      setPinned('s1', false, tmpDir);
      expect(getEntry('s1', tmpDir).pinned).toBe(false);
    });

    it('deleteEntry 清条目', () => {
      setState('s1', 'stale', tmpDir);
      expect(deleteEntry('s1', tmpDir)).toBe(true);
      expect(deleteEntry('s1', tmpDir)).toBe(false); // 二次返回 false
      expect(getEntry('s1', tmpDir).state).toBe('active'); // 又回到默认
    });

    it('listLifecycleEntries', () => {
      setState('a', 'stale', tmpDir);
      setState('b', 'archived', tmpDir);
      setPinned('c', true, tmpDir);
      const list = listLifecycleEntries(tmpDir);
      expect(list).toHaveLength(3);
      expect(list.find(e => e.name === 'a')!.state).toBe('stale');
      expect(list.find(e => e.name === 'b')!.state).toBe('archived');
      expect(list.find(e => e.name === 'c')!.pinned).toBe(true);
    });
  });

  // ─── archiveSkill ───────────────────────────────────────────────────────

  describe('archiveSkill', () => {
    function plantSkill(name: string, content: string = 'body'): string {
      const dir = path.join(tmpDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n${content}`, 'utf-8');
      return dir;
    }

    it('物理移动到 .archive/<name> + 标 archived', () => {
      plantSkill('arxiv');
      const r = archiveSkill('arxiv', tmpDir);
      expect(r.ok).toBe(true);
      expect(r.archivedPath).toBe(path.join(tmpDir, '.archive', 'arxiv'));
      expect(fs.existsSync(path.join(tmpDir, 'arxiv'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, '.archive', 'arxiv', 'SKILL.md'))).toBe(true);
      expect(getEntry('arxiv', tmpDir).state).toBe('archived');
    });

    it('pinned skill 拒绝归档', () => {
      plantSkill('pinned-skill');
      setPinned('pinned-skill', true, tmpDir);
      const r = archiveSkill('pinned-skill', tmpDir);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/pinned/);
      // 目录还在原处
      expect(fs.existsSync(path.join(tmpDir, 'pinned-skill'))).toBe(true);
    });

    it('skill 目录不存在 → 失败', () => {
      const r = archiveSkill('no-such', tmpDir);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/not found/);
    });

    it('.archive/<name> 已存在 → 加时间戳后缀', () => {
      plantSkill('foo');
      archiveSkill('foo', tmpDir);
      // 重新种一个同名 skill，再 archive 一次
      plantSkill('foo');
      const r = archiveSkill('foo', tmpDir);
      expect(r.ok).toBe(true);
      expect(r.archivedPath).toMatch(/foo-\d{14}$/);
    });
  });

  // ─── restoreSkill ───────────────────────────────────────────────────────

  describe('restoreSkill', () => {
    function plantArchived(name: string): string {
      const archiveDir = path.join(tmpDir, '.archive', name);
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(path.join(archiveDir, 'SKILL.md'), `---\nname: ${name}\n---\nbody`, 'utf-8');
      setState(name, 'archived', tmpDir);
      return archiveDir;
    }

    it('恢复到原位 + state 重置 active', () => {
      plantArchived('arxiv');
      const r = restoreSkill('arxiv', tmpDir);
      expect(r.ok).toBe(true);
      expect(r.restoredPath).toBe(path.join(tmpDir, 'arxiv'));
      expect(fs.existsSync(path.join(tmpDir, 'arxiv', 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.archive', 'arxiv'))).toBe(false);
      const e = getEntry('arxiv', tmpDir);
      expect(e.state).toBe('active');
      expect(e.archivedAt).toBeNull();
    });

    it('原位已存在同名 → 拒绝（避免 shadow）', () => {
      plantArchived('arxiv');
      // 模拟用户后来又装了一个同名 skill
      fs.mkdirSync(path.join(tmpDir, 'arxiv'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'arxiv', 'SKILL.md'), 'new', 'utf-8');
      const r = restoreSkill('arxiv', tmpDir);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/already exists/);
    });

    it('精确匹配不存在时前缀匹配最新 timestamped 副本', () => {
      // 模拟之前 archive 时碰撞重命名为 foo-20260507120000
      const archiveRoot = path.join(tmpDir, '.archive');
      fs.mkdirSync(path.join(archiveRoot, 'foo-20250101000000'), { recursive: true });
      fs.mkdirSync(path.join(archiveRoot, 'foo-20260507120000'), { recursive: true });
      fs.writeFileSync(path.join(archiveRoot, 'foo-20260507120000', 'SKILL.md'), 'newest', 'utf-8');
      fs.writeFileSync(path.join(archiveRoot, 'foo-20250101000000', 'SKILL.md'), 'older', 'utf-8');

      const r = restoreSkill('foo', tmpDir);
      expect(r.ok).toBe(true);
      // 应该恢复最新的（按 sort 倒序最新文件名最大）
      const restored = fs.readFileSync(path.join(tmpDir, 'foo', 'SKILL.md'), 'utf-8');
      expect(restored).toBe('newest');
    });

    it('archive 目录不存在 → 失败', () => {
      const r = restoreSkill('no-such', tmpDir);
      expect(r.ok).toBe(false);
    });

    it('archive 目录存在但找不到 → 失败', () => {
      fs.mkdirSync(path.join(tmpDir, '.archive'), { recursive: true });
      const r = restoreSkill('no-such', tmpDir);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/no archived skill/);
    });
  });
});
