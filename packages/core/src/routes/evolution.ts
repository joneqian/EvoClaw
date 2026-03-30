/**
 * 进化路由 — 能力图谱 + 成长追踪 + Heartbeat 配置
 */

import { Hono } from 'hono';
import { CapabilityGraph } from '../evolution/capability-graph.js';
import { GrowthTracker } from '../evolution/growth-tracker.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { HeartbeatConfig } from '@evoclaw/shared';
import type { HeartbeatManager } from '../scheduler/heartbeat-manager.js';

interface EvolutionRouteDeps {
  db: SqliteStore;
  getHeartbeatManager?: () => HeartbeatManager | undefined;
}

/** 创建进化路由 */
export function createEvolutionRoutes(deps: EvolutionRouteDeps): Hono {
  const { db, getHeartbeatManager } = deps;
  const app = new Hono();
  const capGraph = new CapabilityGraph(db);
  const tracker = new GrowthTracker(db);

  /** GET /:agentId/capabilities — 能力图谱 */
  app.get('/:agentId/capabilities', (c) => {
    const agentId = c.req.param('agentId');
    const capabilities = capGraph.getCapabilityGraph(agentId);
    return c.json({ capabilities });
  });

  /** GET /:agentId/growth — 成长事件列表 */
  app.get('/:agentId/growth', (c) => {
    const agentId = c.req.param('agentId');
    const limit = Number(c.req.query('limit')) || 20;
    const events = tracker.getRecentEvents(agentId, limit);
    return c.json({ events });
  });

  /** GET /:agentId/growth/vector — 成长向量 */
  app.get('/:agentId/growth/vector', (c) => {
    const agentId = c.req.param('agentId');
    const days = Number(c.req.query('days')) || 7;
    const vector = tracker.computeGrowthVector(agentId, days);
    return c.json({ vector });
  });

  /** GET /:agentId/heartbeat — 获取 Heartbeat 配置 */
  app.get('/:agentId/heartbeat', (c) => {
    const agentId = c.req.param('agentId');
    const row = db.get<{ config_json: string }>(
      "SELECT details AS config_json FROM audit_log WHERE agent_id = ? AND action = 'heartbeat_config' ORDER BY created_at DESC LIMIT 1",
      agentId,
    );
    const config: HeartbeatConfig = row
      ? JSON.parse(row.config_json)
      : { intervalMinutes: 30, activeHours: { start: '08:00', end: '22:00' }, enabled: false };
    return c.json({ config });
  });

  /** PUT /:agentId/heartbeat — 更新 Heartbeat 配置 */
  app.put('/:agentId/heartbeat', async (c) => {
    const agentId = c.req.param('agentId');
    const config = await c.req.json<HeartbeatConfig>();

    // 存到 audit_log 作为配置存储
    db.run(
      `INSERT INTO audit_log (agent_id, action, details, created_at)
       VALUES (?, 'heartbeat_config', ?, ?)`,
      agentId,
      JSON.stringify(config),
      new Date().toISOString(),
    );

    // 同步到运行中的 HeartbeatManager
    getHeartbeatManager?.()?.updateConfig(agentId, config);

    return c.json({ config });
  });

  return app;
}
