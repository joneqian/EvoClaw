/**
 * 同事印象记忆 REST 路由（M13 #3 PR3）
 *
 * 用于排障 / 未来前端 Team Mode 调试页消费：
 *   GET /peer-impressions?agentId=X&limit=N
 *     列出 owner 视角下所有 peer 印象
 *   GET /peer-impressions/:peerAgentId?ownerAgentId=Y
 *     单条详情（PeerImpressionL1 + memory_unit 元数据）
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import {
  listPeerImpressions,
  readPeerImpression,
} from '../memory/peer-impression-extractor.js';

const log = createLogger('peer-impression-routes');

export interface PeerImpressionRouteDeps {
  db: SqliteStore;
}

const listQuerySchema = z.object({
  agentId: z.string().min(1, 'agentId 不能为空'),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const detailQuerySchema = z.object({
  ownerAgentId: z.string().min(1, 'ownerAgentId 不能为空'),
});

export function createPeerImpressionRoutes(deps: PeerImpressionRouteDeps): Hono {
  const app = new Hono();

  /** GET /?agentId=X&limit=50 */
  app.get('/', (c) => {
    const parsed = listQuerySchema.safeParse({
      agentId: c.req.query('agentId'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { agentId, limit } = parsed.data;
    try {
      const rows = listPeerImpressions(deps.db, agentId, { limit: limit ?? 50 });
      return c.json({
        ownerAgentId: agentId,
        count: rows.length,
        impressions: rows.map((r) => ({
          peerAgentId: r.l1.peerAgentId,
          peerName: r.l1.peerName,
          summary: r.memoryUnit.l0Index,
          l1: r.l1,
          confidence: r.memoryUnit.confidence,
          activation: r.memoryUnit.activation,
          updatedAt: r.memoryUnit.updatedAt,
          createdAt: r.memoryUnit.createdAt,
          memoryId: r.memoryUnit.id,
        })),
      });
    } catch (err) {
      log.error(`[list] error agent=${agentId}: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /** GET /:peerAgentId?ownerAgentId=Y */
  app.get('/:peerAgentId', (c) => {
    const peerAgentId = c.req.param('peerAgentId');
    const parsed = detailQuerySchema.safeParse({
      ownerAgentId: c.req.query('ownerAgentId'),
    });
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const { ownerAgentId } = parsed.data;
    try {
      const found = readPeerImpression(deps.db, ownerAgentId, peerAgentId);
      if (!found) {
        return c.json({ error: 'not found' }, 404);
      }
      return c.json({
        ownerAgentId,
        peerAgentId,
        memoryId: found.memoryUnit.id,
        summary: found.memoryUnit.l0Index,
        l1: found.l1,
        l2: found.memoryUnit.l2Content,
        confidence: found.memoryUnit.confidence,
        activation: found.memoryUnit.activation,
        createdAt: found.memoryUnit.createdAt,
        updatedAt: found.memoryUnit.updatedAt,
      });
    } catch (err) {
      log.error(`[detail] error owner=${ownerAgentId} peer=${peerAgentId}: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  return app;
}
