/**
 * skill-curator-state-machine 单测
 *
 * 验证：
 * - active → stale (anchor < now-30d 且 active)
 * - stale → archived (anchor < now-90d)
 * - active → archived (anchor < now-90d 跳过 stale 直接归档)
 * - stale → active (anchor 重新 > now-30d，反激活)
 * - pinned 全跳过
 * - source != 'agent-created' 全跳过（bundled / clawhub / github / local）
 * - lastInvokedAt 优先 / 回退 manifest.createdAt / 回退 SKILL.md mtime
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { upsertManifestEntry, computeSkillHash, type SkillManifestSource } from '../../skill/skill-manifest.js';
import {
  applyAutomaticTransitions,
} from '../../skill/skill-curator-state-machine.js';
import {
  getEntry,
  setPinned,
  setState,
} from '../../skill/skill-curator-lifecycle.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATIONS = [
  '001_initial.sql',
  '027_skill_usage.sql',
  '028_skill_evolution_log.sql',
  '037_skill_inline_review.sql',
].map(f => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));

const AGENT_ID = 'agent-test';
const NOW = new Date('2026-05-07T12:00:00Z');

function plantSkill(
  baseDir: string,
  name: string,
  source: SkillManifestSource,
  options: { createdDaysAgo?: number; body?: string } = {},
): void {
  const skillDir = path.join(baseDir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: t\n---\n${options.body ?? 'body'}`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  const createdAt = options.createdDaysAgo !== undefined
    ? new Date(NOW.getTime() - options.createdDaysAgo * 86400_000).toISOString()
    : new Date().toISOString();
  upsertManifestEntry(baseDir, {
    name, sha256: computeSkillHash(content), source, createdAt,
  });
}

function recordUsage(db: SqliteStore, skillName: string, daysAgo: number): void {
  const ts = new Date(NOW.getTime() - daysAgo * 86400_000).toISOString();
  db.run(
    `INSERT INTO skill_usage (skill_name, agent_id, session_key, invoked_at, trigger_type, execution_mode, success)
     VALUES (?, ?, ?, ?, 'invoke_skill', 'inline', 1)`,
    skillName, AGENT_ID, 'sk-test', ts,
  );
}

describe('applyAutomaticTransitions', () => {
  let db: SqliteStore;
  let tmpDir: string;
  let userSkillsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-sm-'));
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    for (const m of MIGRATIONS) db.exec(m);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('active skill 用过 50 天前 → stale', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created');
    recordUsage(db, 's1', 50);

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.checked).toBe(1);
    expect(r.markedStale).toBe(1);
    expect(getEntry('s1', userSkillsDir).state).toBe('stale');
  });

  it('active skill 用过 100 天前 → 直接 archived（跳过 stale）', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created');
    recordUsage(db, 's1', 100);

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.archived).toBe(1);
    expect(r.markedStale).toBe(0);
    expect(getEntry('s1', userSkillsDir).state).toBe('archived');
    // 物理移到 .archive/
    expect(fs.existsSync(path.join(userSkillsDir, 's1'))).toBe(false);
    expect(fs.existsSync(path.join(userSkillsDir, '.archive', 's1'))).toBe(true);
  });

  it('stale skill 重新用 → active 反激活', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created');
    setState('s1', 'stale', userSkillsDir);
    recordUsage(db, 's1', 5); // 5 天前用过

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.reactivated).toBe(1);
    expect(getEntry('s1', userSkillsDir).state).toBe('active');
  });

  it('stale skill 仍然不活跃但 < 90d → 保持 stale 不归档', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created');
    setState('s1', 'stale', userSkillsDir);
    recordUsage(db, 's1', 60); // 60 天前

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.markedStale).toBe(0);
    expect(r.archived).toBe(0);
    expect(r.reactivated).toBe(0);
    expect(getEntry('s1', userSkillsDir).state).toBe('stale');
  });

  it('stale skill anchor < 90d → 归档', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created');
    setState('s1', 'stale', userSkillsDir);
    recordUsage(db, 's1', 100);

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.archived).toBe(1);
    expect(getEntry('s1', userSkillsDir).state).toBe('archived');
  });

  it('pinned skill 全跳过（不论年龄）', () => {
    plantSkill(userSkillsDir, 'pinned1', 'agent-created');
    plantSkill(userSkillsDir, 'pinned2', 'agent-created');
    setPinned('pinned1', true, userSkillsDir);
    setPinned('pinned2', true, userSkillsDir);
    recordUsage(db, 'pinned1', 50);  // 应该 stale
    recordUsage(db, 'pinned2', 100); // 应该 archived

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.skippedPinned).toBe(2);
    expect(r.markedStale).toBe(0);
    expect(r.archived).toBe(0);
  });

  it('非 agent-created 来源全部跳过', () => {
    plantSkill(userSkillsDir, 'bundled-x', 'bundled');
    plantSkill(userSkillsDir, 'hub-x', 'clawhub');
    plantSkill(userSkillsDir, 'gh-x', 'github');
    plantSkill(userSkillsDir, 'user-x', 'local');
    // 都用过 100 天前 — 但都不是 agent-created，应跳过
    recordUsage(db, 'bundled-x', 100);
    recordUsage(db, 'hub-x', 100);
    recordUsage(db, 'gh-x', 100);
    recordUsage(db, 'user-x', 100);

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.checked).toBe(0); // 全部不在候选范围
    expect(r.archived).toBe(0);
  });

  it('skill 从未被调用 → 用 manifest.createdAt 作 anchor', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created', { createdDaysAgo: 50 });
    // 不录用法记录

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.markedStale).toBe(1);
  });

  it('刚创建的 skill 不应立即被归档', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created', { createdDaysAgo: 1 });

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.archived).toBe(0);
    expect(r.markedStale).toBe(0);
    expect(getEntry('s1', userSkillsDir).state).toBe('active');
  });

  it('多个 skill 混合状态', () => {
    plantSkill(userSkillsDir, 'fresh', 'agent-created', { createdDaysAgo: 5 });
    plantSkill(userSkillsDir, 'old1', 'agent-created');
    plantSkill(userSkillsDir, 'old2', 'agent-created');
    plantSkill(userSkillsDir, 'pinned', 'agent-created');
    plantSkill(userSkillsDir, 'stale-but-recent', 'agent-created');
    setPinned('pinned', true, userSkillsDir);
    setState('stale-but-recent', 'stale', userSkillsDir);

    recordUsage(db, 'fresh', 1);                  // 仍 active
    recordUsage(db, 'old1', 50);                   // active → stale
    recordUsage(db, 'old2', 100);                  // active → archived
    recordUsage(db, 'pinned', 100);                // pinned 跳过
    recordUsage(db, 'stale-but-recent', 5);        // stale → active

    const r = applyAutomaticTransitions({ db, userSkillsDir, now: NOW });
    expect(r.checked).toBe(5);
    expect(r.markedStale).toBe(1);
    expect(r.archived).toBe(1);
    expect(r.reactivated).toBe(1);
    expect(r.skippedPinned).toBe(1);
  });

  it('自定义阈值', () => {
    plantSkill(userSkillsDir, 's1', 'agent-created');
    recordUsage(db, 's1', 10); // 10 天前

    // 默认阈值不会触发；自定义 stale=7 / archived=20 时应 stale
    const r = applyAutomaticTransitions({
      db, userSkillsDir, now: NOW,
      staleDays: 7, archivedDays: 20,
    });
    expect(r.markedStale).toBe(1);
  });
});
