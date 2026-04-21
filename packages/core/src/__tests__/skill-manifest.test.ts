import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeSkillHash,
  readManifest,
  writeManifest,
  upsertManifestEntry,
  removeManifestEntry,
  syncBundledSkills,
  MANIFEST_FILENAME,
} from '../skill/skill-manifest.js';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(baseDir: string, name: string, content: string): void {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

function validSkillContent(name: string, body = 'body'): string {
  return `---\nname: ${name}\ndescription: test desc\n---\n\n${body}\n`;
}

describe('skill-manifest', () => {
  let userDir: string;
  let bundledDir: string;

  beforeEach(() => {
    userDir = mkTmpDir('skill-manifest-user-');
    bundledDir = mkTmpDir('skill-manifest-bundled-');
  });

  afterEach(() => {
    fs.rmSync(userDir, { recursive: true, force: true });
    fs.rmSync(bundledDir, { recursive: true, force: true });
  });

  describe('computeSkillHash', () => {
    it('相同内容产生相同 hash', () => {
      expect(computeSkillHash('abc')).toBe(computeSkillHash('abc'));
    });
    it('不同内容产生不同 hash', () => {
      expect(computeSkillHash('abc')).not.toBe(computeSkillHash('abd'));
    });
  });

  describe('readManifest / writeManifest', () => {
    it('读空 manifest 返回空 Map', () => {
      const m = readManifest(userDir);
      expect(m.size).toBe(0);
    });

    it('写入后可读回', () => {
      const entry = {
        name: 'my-skill',
        sha256: 'abc123',
        source: 'agent-created' as const,
        createdAt: '2026-04-21T08:00:00Z',
      };
      writeManifest(userDir, [entry]);
      const m = readManifest(userDir);
      expect(m.get('my-skill')).toEqual(entry);
    });

    it('多条记录按 name 排序写入', () => {
      writeManifest(userDir, [
        { name: 'c-skill', sha256: 'c', source: 'bundled', createdAt: '2026-01-01T00:00:00Z' },
        { name: 'a-skill', sha256: 'a', source: 'bundled', createdAt: '2026-01-01T00:00:00Z' },
        { name: 'b-skill', sha256: 'b', source: 'bundled', createdAt: '2026-01-01T00:00:00Z' },
      ]);
      const raw = fs.readFileSync(path.join(userDir, MANIFEST_FILENAME), 'utf-8');
      const lines = raw.split('\n').filter(l => l && !l.startsWith('#'));
      expect(lines.map(l => l.split(':')[0])).toEqual(['a-skill', 'b-skill', 'c-skill']);
    });

    it('无效 source → 跳过', () => {
      fs.writeFileSync(
        path.join(userDir, MANIFEST_FILENAME),
        '# hdr\nfoo:hash:unknown-source:2026-01-01T00:00:00Z\n',
      );
      const m = readManifest(userDir);
      expect(m.size).toBe(0);
    });
  });

  describe('upsertManifestEntry / removeManifestEntry', () => {
    it('upsert 新增', () => {
      upsertManifestEntry(userDir, {
        name: 's1', sha256: 'h1', source: 'agent-created', createdAt: '2026-01-01T00:00:00Z',
      });
      expect(readManifest(userDir).get('s1')?.sha256).toBe('h1');
    });

    it('upsert 覆盖', () => {
      upsertManifestEntry(userDir, {
        name: 's1', sha256: 'h1', source: 'agent-created', createdAt: '2026-01-01T00:00:00Z',
      });
      upsertManifestEntry(userDir, {
        name: 's1', sha256: 'h2', source: 'agent-created', createdAt: '2026-01-02T00:00:00Z',
      });
      expect(readManifest(userDir).get('s1')?.sha256).toBe('h2');
    });

    it('remove 不存在的记录不抛异常', () => {
      expect(() => removeManifestEntry(userDir, 'nonexistent')).not.toThrow();
    });

    it('remove 已有记录', () => {
      upsertManifestEntry(userDir, {
        name: 's1', sha256: 'h1', source: 'agent-created', createdAt: '2026-01-01T00:00:00Z',
      });
      removeManifestEntry(userDir, 's1');
      expect(readManifest(userDir).has('s1')).toBe(false);
    });
  });

  describe('syncBundledSkills', () => {
    it('NEW：bundled 新 skill → 复制到用户目录', () => {
      writeSkill(bundledDir, 'new-skill', validSkillContent('new-skill'));
      const result = syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      expect(result.actions).toContainEqual(expect.objectContaining({ name: 'new-skill', action: 'copied' }));
      expect(fs.existsSync(path.join(userDir, 'new-skill', 'SKILL.md'))).toBe(true);
      expect(readManifest(userDir).get('new-skill')?.source).toBe('bundled');
    });

    it('EXISTING + 用户未改 → 安全升级', () => {
      // 初始同步
      writeSkill(bundledDir, 'x', validSkillContent('x', 'v1 body'));
      syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      // bundled 更新
      writeSkill(bundledDir, 'x', validSkillContent('x', 'v2 body'));
      const result = syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      expect(result.actions).toContainEqual(expect.objectContaining({ name: 'x', action: 'updated' }));
      const content = fs.readFileSync(path.join(userDir, 'x', 'SKILL.md'), 'utf-8');
      expect(content).toContain('v2 body');
    });

    it('EXISTING + 用户改过 → 跳过升级', () => {
      writeSkill(bundledDir, 'x', validSkillContent('x', 'v1 body'));
      syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      // 用户改了
      fs.writeFileSync(path.join(userDir, 'x', 'SKILL.md'), validSkillContent('x', 'user modified'), 'utf-8');
      // bundled 也更新了
      writeSkill(bundledDir, 'x', validSkillContent('x', 'v2 body'));
      const result = syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      expect(result.actions).toContainEqual(expect.objectContaining({ name: 'x', action: 'skipped-user-modified' }));
      const content = fs.readFileSync(path.join(userDir, 'x', 'SKILL.md'), 'utf-8');
      expect(content).toContain('user modified');
    });

    it('DELETED + 用户未改 → 删除用户副本', () => {
      writeSkill(bundledDir, 'x', validSkillContent('x'));
      syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      // bundled 中移除
      fs.rmSync(path.join(bundledDir, 'x'), { recursive: true });
      const result = syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      expect(result.actions).toContainEqual(expect.objectContaining({ name: 'x', action: 'deleted' }));
      expect(fs.existsSync(path.join(userDir, 'x'))).toBe(false);
    });

    it('DELETED + 用户改过 → 保留并降级为 local', () => {
      writeSkill(bundledDir, 'x', validSkillContent('x', 'v1'));
      syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      fs.writeFileSync(path.join(userDir, 'x', 'SKILL.md'), validSkillContent('x', 'kept'), 'utf-8');
      fs.rmSync(path.join(bundledDir, 'x'), { recursive: true });
      const result = syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      expect(result.actions).toContainEqual(expect.objectContaining({ name: 'x', action: 'kept' }));
      expect(fs.existsSync(path.join(userDir, 'x', 'SKILL.md'))).toBe(true);
      expect(readManifest(userDir).get('x')?.source).toBe('local');
    });

    it('不触碰 agent-created skill', () => {
      // 用户目录下有 agent-created
      writeSkill(userDir, 'agent-x', validSkillContent('agent-x', 'body'));
      upsertManifestEntry(userDir, {
        name: 'agent-x',
        sha256: computeSkillHash(validSkillContent('agent-x', 'body')),
        source: 'agent-created',
        createdAt: '2026-04-21T00:00:00Z',
      });

      // bundled 目录不含 agent-x
      writeSkill(bundledDir, 'bundled-y', validSkillContent('bundled-y'));
      syncBundledSkills({ bundledDir, userSkillsDir: userDir });

      // agent-x 仍然存在
      expect(fs.existsSync(path.join(userDir, 'agent-x', 'SKILL.md'))).toBe(true);
      expect(readManifest(userDir).get('agent-x')?.source).toBe('agent-created');
    });
  });
});
