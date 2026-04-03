/**
 * 安全策略管理路由
 *
 * IT 管理员通过这些 API 管控 Skill 和 MCP Server 的白名单/黑名单。
 */

import { Hono } from 'hono';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { ExtensionSecurityPolicy, NameSecurityPolicy } from '@evoclaw/shared';
import { evaluateAccess } from '../security/extension-security.js';

/** 创建安全策略路由 */
export function createSecurityPolicyRoutes(configManager: ConfigManager): Hono {
  const app = new Hono();

  /** GET / — 获取当前安全策略 */
  app.get('/', (c) => {
    const policy = configManager.getSecurityPolicy();
    return c.json({ policy: policy ?? {} });
  });

  /** PUT / — 更新安全策略（完整替换） */
  app.put('/', async (c) => {
    try {
      const body = await c.req.json<{ policy: ExtensionSecurityPolicy }>();
      if (!body.policy || typeof body.policy !== 'object') {
        return c.json({ error: '请提供 policy 对象' }, 400);
      }

      // 基本校验：allowlist/denylist/disabled 必须是字符串数组
      for (const key of ['skills', 'mcpServers'] as const) {
        const sub = body.policy[key] as NameSecurityPolicy | undefined;
        if (!sub) continue;
        for (const field of ['allowlist', 'denylist', 'disabled'] as const) {
          const val = sub[field];
          if (val !== undefined && (!Array.isArray(val) || val.some((v: unknown) => typeof v !== 'string'))) {
            return c.json({ error: `${key}.${field} 必须是字符串数组` }, 400);
          }
        }
      }

      configManager.updateSecurityPolicy(body.policy);
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
