/**
 * Skill 管理路由
 */

import { Hono } from 'hono';
import { SkillDiscoverer } from '../skill/skill-discoverer.js';
import { SkillInstaller } from '../skill/skill-installer.js';
import { getLoadedSkills, refreshSkillCache } from '../context/plugins/tool-registry.js';
import type { SkillSource } from '@evoclaw/shared';

/** 创建 Skill 管理路由 */
export function createSkillRoutes(skillsBaseDir?: string): Hono {
  const app = new Hono();
  const discoverer = new SkillDiscoverer(skillsBaseDir);
  const installer = new SkillInstaller(skillsBaseDir);

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
