/**
 * 安全策略管理路由
 *
 * IT 管理员通过这些 API 管控 Skill 和 MCP Server 的白名单/黑名单。
 */

import { Hono } from 'hono';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import { safeParseSecurityPolicy } from '@evoclaw/shared';
import { evaluateAccess } from '../security/extension-security.js';

/** 创建安全策略路由 */
export function createSecurityPolicyRoutes(configManager: ConfigManager): Hono {
  const app = new Hono();

  /** GET / — 获取当前安全策略 */
  app.get('/', (c) => {
    const policy = configManager.getSecurityPolicy();
    return c.json({ policy: policy ?? {} });
  });

  /** PUT / — 更新安全策略（完整替换，Zod 验证） */
  app.put('/', async (c) => {
    try {
      const body = await c.req.json<{ policy: unknown }>();
      if (!body.policy || typeof body.policy !== 'object') {
        return c.json({ error: '请提供 policy 对象' }, 400);
      }

      const result = safeParseSecurityPolicy(body.policy);
      if (!result.success) {
        const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
        return c.json({ error: '安全策略格式无效', issues }, 400);
      }

      configManager.updateSecurityPolicy(result.data);
      return c.json({ success: true });
    } catch {
      return c.json({ error: '请求格式无效' }, 400);
    }
  });

  /** POST /check — 检查单个名称是否允许 */
  app.post('/check', async (c) => {
    try {
      const body = await c.req.json<{ type: 'skill' | 'mcpServer'; name: string }>();
      if (!body.type || !body.name) {
        return c.json({ error: '请提供 type (skill/mcpServer) 和 name' }, 400);
      }

      const policy = body.type === 'skill'
        ? configManager.getSkillSecurityPolicy()
        : configManager.getMcpSecurityPolicy();

      const decision = evaluateAccess(body.name, policy);
      return c.json({ name: body.name, type: body.type, decision });
    } catch {
      return c.json({ error: '请求格式无效' }, 400);
    }
  });

  return app;
}
