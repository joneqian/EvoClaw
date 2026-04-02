/**
 * 使用量统计 HTTP API
 *
 * GET /usage/stats          — 总体统计
 * GET /usage/breakdown/:dim — 按维度聚合（provider/model/agent_id/channel/call_type）
 */

import { Hono } from 'hono';
import type { CostTracker } from '../cost/cost-tracker.js';
import { formatCostMilli } from '../cost/model-pricing.js';

export function createUsageRoutes(costTracker: CostTracker) {
  const app = new Hono();

  /** GET /stats — 总体统计 */
  app.get('/stats', (c) => {
    const agentId = c.req.query('agentId');
    const provider = c.req.query('provider');
    const model = c.req.query('model');
    const channel = c.req.query('channel');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    const stats = costTracker.getStats({
      agentId: agentId || undefined,
      provider: provider || undefined,
      model: model || undefined,
      channel: channel || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    return c.json({
      ...stats,
      formattedCost: formatCostMilli(stats.totalCostMilli),
    });
  });

  /** GET /breakdown/:dimension — 按维度聚合 */
  app.get('/breakdown/:dimension', (c) => {
    const dimension = c.req.param('dimension') as 'provider' | 'model' | 'agent_id' | 'channel' | 'call_type';
    const validDimensions = ['provider', 'model', 'agent_id', 'channel', 'call_type'];
    if (!validDimensions.includes(dimension)) {
      return c.json({ error: `无效维度: ${dimension}，可选: ${validDimensions.join(', ')}` }, 400);
    }

    const agentId = c.req.query('agentId');
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');

    const breakdown = costTracker.getBreakdown(dimension, {
      agentId: agentId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    return c.json(breakdown.map(b => ({
      ...b,
      formattedCost: formatCostMilli(b.stats.totalCostMilli),
    })));
  });

  return app;
}
