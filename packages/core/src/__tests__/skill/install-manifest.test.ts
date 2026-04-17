/**
 * M5 T3: install-manifest sidecar 读写测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  writeManifest,
  readManifest,
  listManifestsBySource,
} from '../../skill/install-manifest.js';

describe('M5 T3 — install-manifest 读写', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'install-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writeManifest 写入 .evoclaw-install.json', () => {
    const skillDir = path.join(tempRoot, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    writeManifest(skillDir, {
      source: 'clawhub',
      slug: 'my-skill',
      installedVersion: '1.0.0',
      installedAt: '2026-04-17T00:00:00.000Z',
    });

    const file = path.join(skillDir, '.evoclaw-install.json');
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(raw.source).toBe('clawhub');
    expect(raw.slug).toBe('my-skill');
    expect(raw.installedVersion).toBe('1.0.0');
  });

  it('readManifest 不存在时返回 null', () => {
    const skillDir = path.join(tempRoot, 'no-manifest');
    fs.mkdirSync(skillDir, { recursive: true });
    expect(readManifest(skillDir)).toBeNull();
  });

  it('readManifest 非法 JSON 返回 null', () => {
    const skillDir = path.join(tempRoot, 'bad');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, '.evoclaw-install.json'), '{invalid json');
    expect(readManifest(skillDir)).toBeNull();
  });

  it('readManifest 缺必需字段时返回 null', () => {
    const skillDir = path.join(tempRoot, 'incomplete');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, '.evoclaw-install.json'), JSON.stringify({ foo: 'bar' }));
    expect(readManifest(skillDir)).toBeNull();
  });

  it('listManifestsBySource 仅返回指定来源且跳过无 manifest 的目录', () => {
    // skill A — clawhub
    const dirA = path.join(tempRoot, 'a');
    fs.mkdirSync(dirA, { recursive: true });
    writeManifest(dirA, {
      source: 'clawhub',
      slug: 'a',
      installedVersion: '1.0.0',
      installedAt: '2026-04-17T00:00:00.000Z',
    });
    // skill B — github（不该被返回）
    const dirB = path.join(tempRoot, 'b');
    fs.mkdirSync(dirB, { recursive: true });
    writeManifest(dirB, {
      source: 'github',
      slug: 'b',
      installedAt: '2026-04-17T00:00:00.000Z',
    });
    // skill C — 无 manifest（不该被返回）
    fs.mkdirSync(path.join(tempRoot, 'c'), { recursive: true });

    const results = listManifestsBySource([tempRoot], 'clawhub');
    expect(results).toHaveLength(1);
    expect(results[0].skillName).toBe('a');
    expect(results[0].manifest.slug).toBe('a');
  });

  it('listManifestsBySource 支持多个 root（跨用户级 / agent 级）', () => {
    const root1 = path.join(tempRoot, 'user');
    const root2 = path.join(tempRoot, 'agent-X');
    fs.mkdirSync(path.join(root1, 'x'), { recursive: true });
    fs.mkdirSync(path.join(root2, 'y'), { recursive: true });
    writeManifest(path.join(root1, 'x'), {
      source: 'clawhub',
      slug: 'x',
      installedAt: '2026-04-17T00:00:00.000Z',
    });
    writeManifest(path.join(root2, 'y'), {
      source: 'clawhub',
      slug: 'y',
      installedAt: '2026-04-17T00:00:00.000Z',
    });

    const results = listManifestsBySource([root1, root2], 'clawhub');
    expect(results.map((r) => r.skillName).sort()).toEqual(['x', 'y']);
  });

  it('listManifestsBySource 不存在的 root 被静默跳过', () => {
    const results = listManifestsBySource([path.join(tempRoot, 'nonexistent')], 'clawhub');
    expect(results).toEqual([]);
  });
});
