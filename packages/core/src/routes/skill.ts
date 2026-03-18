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

  /** GET /browse — 浏览热门/最新技能 */
  app.get('/browse', async (c) => {
    const limit = Number(c.req.query('limit') ?? '30');
    const sort = (c.req.query('sort') ?? 'trending') as 'trending' | 'updated' | 'downloads';
    try {
      const results = await discoverer.browse(limit, sort);
      return c.json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message, results: [] }, 500);
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

    // 返回所有本地 Skill
    const local = discoverer.listLocal();
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

  return app;
}

/** 获取 SkillDiscoverer 实例（供 gap-detection 使用） */
export function createSkillDiscoverer(skillsBaseDir?: string): SkillDiscoverer {
  return new SkillDiscoverer(skillsBaseDir);
}
