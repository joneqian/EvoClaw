/**
 * Skill 管理路由
 */

import { Hono } from 'hono';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { SkillDiscoverer } from '../skill/skill-discoverer.js';
import { SkillInstaller } from '../skill/skill-installer.js';
import { getLoadedSkills, refreshSkillCache } from '../context/plugins/tool-registry.js';
import type { SkillSource } from '@evoclaw/shared';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import type { SkillInstallPolicyOverride } from '../skill/install-policy.js';
import { listManifestsBySource } from '../skill/install-manifest.js';

/** 简易 semver-like 版本比较：返回负数 = a < b，0 = 相等，正数 = a > b */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10));
  const pb = b.split('.').map((s) => parseInt(s, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0; // 非数字段放弃比较
    if (x !== y) return x - y;
  }
  return 0;
}

/** Skill 路由选项 */
export interface SkillRoutesOptions {
  skillsBaseDir?: string;
  /** M5 T2: Skill 安装策略矩阵覆盖提供者（企业 IT 配置） */
  getPolicyOverride?: () => SkillInstallPolicyOverride | undefined;
}

/** 创建 Skill 管理路由 */
export function createSkillRoutes(
  skillsBaseDirOrOptions?: string | SkillRoutesOptions,
): Hono {
  const opts: SkillRoutesOptions =
    typeof skillsBaseDirOrOptions === 'string'
      ? { skillsBaseDir: skillsBaseDirOrOptions }
      : (skillsBaseDirOrOptions ?? {});
  const app = new Hono();
  const discoverer = new SkillDiscoverer(opts.skillsBaseDir);
  const installer = new SkillInstaller(opts.skillsBaseDir, opts.getPolicyOverride);

  /** GET /browse — 浏览技能列表（支持分类/排序/分页/搜索） */
  app.get('/browse', async (c) => {
    const page = Number(c.req.query('page') ?? '1');
    const pageSize = Number(c.req.query('pageSize') ?? '24');
    const sortBy = (c.req.query('sortBy') ?? 'score') as 'score' | 'downloads' | 'installs';
    const category = c.req.query('category') || undefined;
    const keyword = c.req.query('keyword') || undefined;
    try {
      const { results, total } = await discoverer.browse({ page, pageSize, sortBy, category, keyword });
      return c.json({ results, total });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, results: [], total: 0 }, 500);
    }
  });

  /** POST /search — 搜索 ClawHub + 本地 */
  app.post('/search', async (c) => {
    const body = await c.req.json<{ query: string; limit?: number }>();

    try {
      const results = await discoverer.search(body.query, body.limit);
      return c.json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  /** POST /prepare — 下载 + 安全分析 + 门控检查 */
  app.post('/prepare', async (c) => {
    const body = await c.req.json<{
      source: SkillSource;
      identifier: string;
      version?: string;
    }>();

    try {
      const result = await installer.prepare(body.source, body.identifier, body.version);
      return c.json({ result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** POST /confirm — 确认安装 */
  app.post('/confirm', async (c) => {
    const body = await c.req.json<{
      prepareId: string;
      agentId?: string;
    }>();

    try {
      const installPath = installer.confirm(body.prepareId, body.agentId);

      // 刷新 Skill 缓存
      if (body.agentId) {
        refreshSkillCache(body.agentId);
      }

      return c.json({ installPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** POST /check-updates — 查询 ClawHub 来源的已安装 Skill 是否有新版 */
  app.post('/check-updates', async (c) => {
    try {
      // 收集候选 manifest：用户级目录 + 所有 agent 级目录
      const userDir = opts.skillsBaseDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');
      const agentsRoot = path.join(userDir, '..', 'agents');
      const roots: string[] = [userDir];
      if (fs.existsSync(agentsRoot)) {
        for (const e of fs.readdirSync(agentsRoot, { withFileTypes: true })) {
          if (e.isDirectory()) {
            roots.push(path.join(agentsRoot, e.name, 'workspace', 'skills'));
          }
        }
      }

      const clawhubManifests = listManifestsBySource(roots, 'clawhub');
      if (clawhubManifests.length === 0) {
        return c.json({ updates: [] });
      }

      // 批量并发查询 ClawHub（30s 全局超时兜底）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const results = await Promise.allSettled(
          clawhubManifests.map(async (m) => {
            const info = await discoverer.getSkillInfo(m.manifest.slug);
            return { manifest: m, info };
          }),
        );

        const updates: Array<{
          name: string;
          slug: string;
          installedVersion?: string;
          latestVersion: string;
        }> = [];
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value.info?.version) continue;
          const installedVer = r.value.manifest.manifest.installedVersion ?? '0.0.0';
          const latestVer = r.value.info.version;
          if (compareVersions(installedVer, latestVer) < 0) {
            updates.push({
              name: r.value.manifest.skillName,
              slug: r.value.manifest.manifest.slug,
              installedVersion: r.value.manifest.manifest.installedVersion,
              latestVersion: latestVer,
            });
          }
        }
        return c.json({ updates });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ updates: [], error: message }, 200);
    }
  });

  /** GET /list — 已安装列表 */
  app.get('/list', (c) => {
    const agentId = c.req.query('agentId');
    if (agentId) {
      const loaded = getLoadedSkills(agentId);
      return c.json({ skills: loaded });
    }

    // 返回所有本地 Skill（含门控检查结果）
    const local = discoverer.listLocalWithGates();
    return c.json({ skills: local });
  });

  /** DELETE /:name — 卸载 */
  app.delete('/:name', (c) => {
    const name = c.req.param('name');
    const agentId = c.req.query('agentId');

    const success = installer.uninstall(name, agentId ?? undefined);

    // 刷新缓存
    if (agentId) {
      refreshSkillCache(agentId);
    }

    return c.json({ success });
  });

  /** POST /refresh-cache — 清除 Skill 扫描缓存 */
  app.post('/refresh-cache', (c) => {
    const agentId = c.req.query('agentId');
    if (agentId) {
      refreshSkillCache(agentId);
      return c.json({ refreshed: true, agentId });
    }
    // 无 agentId 时清除所有缓存
    return c.json({ refreshed: true, agentId: null });
  });

  return app;
}

/** 获取 SkillDiscoverer 实例（供 gap-detection 使用） */
export function createSkillDiscoverer(skillsBaseDir?: string): SkillDiscoverer {
  return new SkillDiscoverer(skillsBaseDir);
}
