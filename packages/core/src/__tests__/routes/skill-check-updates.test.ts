/**
 * M5 T3: /skill/check-updates 路由测试
 *
 * mock ClawHub /skills/{slug} 响应，验证 manifest 对比逻辑。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSkillRoutes } from '../../routes/skill.js';
import { writeManifest } from '../../skill/install-manifest.js';

describe('M5 T3 — POST /skill/check-updates', () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-updates-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  async function callCheckUpdates(app: ReturnType<typeof createSkillRoutes>) {
    const res = await app.request('/check-updates', { method: 'POST' });
    return res.json() as Promise<{ updates: Array<{ name: string; slug: string; installedVersion?: string; latestVersion: string }>; error?: string }>;
  }

  it('所有 clawhub skill 已是最新时 updates 为空', async () => {
    const skillDir = path.join(tempDir, 'foo');
    fs.mkdirSync(skillDir, { recursive: true });
    writeManifest(skillDir, {
      source: 'clawhub',
      slug: 'foo',
      installedVersion: '2.0.0',
      installedAt: '2026-04-17T00:00:00.000Z',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skill: { slug: 'foo', displayName: 'Foo' },
        latestVersion: { version: '2.0.0' },
      }),
    }) as unknown as typeof fetch;

    const app = createSkillRoutes({ skillsBaseDir: tempDir });
    const data = await callCheckUpdates(app);
    expect(data.updates).toEqual([]);
  });

  it('发现新版时返回 updates 条目', async () => {
    const skillDir = path.join(tempDir, 'bar');
    fs.mkdirSync(skillDir, { recursive: true });
    writeManifest(skillDir, {
      source: 'clawhub',
      slug: 'bar',
      installedVersion: '1.0.0',
      installedAt: '2026-04-17T00:00:00.000Z',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skill: { slug: 'bar', displayName: 'Bar' },
        latestVersion: { version: '1.2.3' },
      }),
    }) as unknown as typeof fetch;

    const app = createSkillRoutes({ skillsBaseDir: tempDir });
    const data = await callCheckUpdates(app);
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0]).toMatchObject({
      name: 'bar',
      slug: 'bar',
      installedVersion: '1.0.0',
      latestVersion: '1.2.3',
    });
  });

  it('github 来源的 skill 不纳入比对', async () => {
    const skillDir = path.join(tempDir, 'gh-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    writeManifest(skillDir, {
      source: 'github',
      slug: 'user/repo',
      installedVersion: '1.0.0',
      installedAt: '2026-04-17T00:00:00.000Z',
    });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = createSkillRoutes({ skillsBaseDir: tempDir });
    const data = await callCheckUpdates(app);
    expect(data.updates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('无 manifest 的目录（本地 / bundled）不触发远端查询', async () => {
    fs.mkdirSync(path.join(tempDir, 'local-only'), { recursive: true });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const app = createSkillRoutes({ skillsBaseDir: tempDir });
    const data = await callCheckUpdates(app);
    expect(data.updates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ClawHub 查询失败时静默（不抛错，返回空）', async () => {
    const skillDir = path.join(tempDir, 'x');
    fs.mkdirSync(skillDir, { recursive: true });
    writeManifest(skillDir, {
      source: 'clawhub',
      slug: 'x',
      installedVersion: '1.0.0',
      installedAt: '2026-04-17T00:00:00.000Z',
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    const app = createSkillRoutes({ skillsBaseDir: tempDir });
    const data = await callCheckUpdates(app);
    expect(data.updates).toEqual([]);
  });

  it('安装版本缺失时视作 0.0.0，远端任意非 0 版本都算有更新', async () => {
    const skillDir = path.join(tempDir, 'noversion');
    fs.mkdirSync(skillDir, { recursive: true });
    writeManifest(skillDir, {
      source: 'clawhub',
      slug: 'noversion',
      installedAt: '2026-04-17T00:00:00.000Z',
      // installedVersion 未设置
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skill: { slug: 'noversion' },
        latestVersion: { version: '0.1.0' },
      }),
    }) as unknown as typeof fetch;

    const app = createSkillRoutes({ skillsBaseDir: tempDir });
    const data = await callCheckUpdates(app);
    expect(data.updates).toHaveLength(1);
    expect(data.updates[0].latestVersion).toBe('0.1.0');
  });
});
