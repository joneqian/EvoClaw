/**
 * M13 Phase 1 PR-1B — identityLinks REST endpoints
 *
 * 路径：/identity-links
 *
 * 端点：
 *   GET    /identity-links                  列出所有身份链
 *   GET    /identity-links?canonical=X      按 canonical 过滤
 *   POST   /identity-links                  添加 / 更新（{ canonicalId, channel, peerId }）
 *   DELETE /identity-links?channel=X&peer=Y 删除指定渠道身份
 *   DELETE /identity-links?canonical=X      删除整个 canonical
 *
 * UI（apps/desktop SettingsPage "我的多渠道身份"）调用以上 endpoints。
 */

import { Hono } from 'hono';
import { createLogger } from '../infrastructure/logger.js';
import type { IdentityLinksStore } from '../routing/identity-links-store.js';

const log = createLogger('identity-links-routes');

export interface IdentityLinksRouteDeps {
  store: IdentityLinksStore;
}

export function createIdentityLinksRoutes(deps: IdentityLinksRouteDeps): Hono {
  const app = new Hono();

  /** GET /identity-links?canonical=X */
  app.get('/', (c) => {
    const canonical = c.req.query('canonical');
    const links = canonical ? deps.store.listByCanonical(canonical) : deps.store.listAll();
    return c.json({ links });
  });

  /** POST /identity-links — { canonicalId, channel, peerId } */
  app.post('/', async (c) => {
    let body: { canonicalId?: string; channel?: string; peerId?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { canonicalId, channel, peerId } = body;
    if (!canonicalId || !channel || !peerId) {
      return c.json({ error: 'canonicalId / channel / peerId 必填' }, 400);
    }
    try {
      deps.store.link(canonicalId, channel, peerId);
      log.info(`POST /identity-links canonical=${canonicalId} channel=${channel} peer=${peerId}`);
      return c.json({ ok: true });
    } catch (err) {
      log.error(`POST /identity-links failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: err instanceof Error ? err.message : 'link failed' }, 500);
    }
  });

  /** DELETE /identity-links?channel=X&peer=Y 或 ?canonical=Z */
  app.delete('/', (c) => {
    const channel = c.req.query('channel');
    const peerId = c.req.query('peer');
    const canonical = c.req.query('canonical');

    if (canonical) {
      const removed = deps.store.unlinkCanonical(canonical);
      log.info(`DELETE /identity-links canonical=${canonical} affected=${removed}`);
      return c.json({ ok: true, removed });
    }
    if (channel && peerId) {
      const removed = deps.store.unlink(channel, peerId);
      log.info(`DELETE /identity-links channel=${channel} peer=${peerId} affected=${removed}`);
      return c.json({ ok: true, removed });
    }
    return c.json({ error: '需要提供 canonical 或 (channel + peer) 参数' }, 400);
  });

  return app;
}
