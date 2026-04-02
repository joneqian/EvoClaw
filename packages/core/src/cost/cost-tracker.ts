/**
 * 成本追踪器 — 聚合 token 使用量、计算费用、持久化到 DB
 *
 * 集成方式:
 * - queryLoop 完成后，embedded-runner-attempt 调用 track() 记录
 * - HTTP API 查询聚合统计
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { calculateCostMilli } from './model-pricing.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('cost-tracker');

/** 单次 API 调用的使用数据 */
export interface UsageRecord {
  agentId: string;
  sessionKey?: string;
  channel?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  callType?: string;
  success?: boolean;
  errorCode?: string;
  latencyMs?: number;
  turnCount?: number;
}

/** 聚合统计结果 */
export interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostMilli: number;
  callCount: number;
}

/** 按维度聚合 */
export interface UsageBreakdown {
  dimension: string;  // provider / model / agent / channel / call_type
  value: string;
  stats: UsageStats;
}

export class CostTracker {
  constructor(private db: SqliteStore) {}

  /** 记录一次 API 调用的 token 使用和成本 */
  track(record: UsageRecord): void {
    const totalTokens = record.inputTokens + record.outputTokens
      + (record.cacheReadTokens ?? 0) + (record.cacheWriteTokens ?? 0);
    const costMilli = calculateCostMilli(
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.cacheReadTokens ?? 0,
      record.cacheWriteTokens ?? 0,
    );

    this.db.run(
      `INSERT INTO usage_tracking (
        id, agent_id, session_key, channel, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
        estimated_cost_milli, call_type, success, error_code, latency_ms, turn_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      record.agentId,
      record.sessionKey ?? null,
      record.channel ?? 'desktop',
      record.provider,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.cacheReadTokens ?? 0,
      record.cacheWriteTokens ?? 0,
      totalTokens,
      costMilli,
      record.callType ?? 'chat',
      record.success !== false ? 1 : 0,
      record.errorCode ?? null,
      record.latencyMs ?? null,
      record.turnCount ?? 1,
      new Date().toISOString(),
    );

    log.debug(
      `使用记录: ${record.provider}/${record.model} ` +
      `in=${record.inputTokens} out=${record.outputTokens} ` +
      `cache_r=${record.cacheReadTokens ?? 0} cache_w=${record.cacheWriteTokens ?? 0} ` +
      `cost=${costMilli}milli`,
    );
  }

  /** 查询聚合统计 */
  getStats(filters?: {
    agentId?: string;
    provider?: string;
    model?: string;
    channel?: string;
    startDate?: string;
    endDate?: string;
  }): UsageStats {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.agentId) { conditions.push('agent_id = ?'); params.push(filters.agentId); }
    if (filters?.provider) { conditions.push('provider = ?'); params.push(filters.provider); }
    if (filters?.model) { conditions.push('model = ?'); params.push(filters.model); }
    if (filters?.channel) { conditions.push('channel = ?'); params.push(filters.channel); }
    if (filters?.startDate) { conditions.push('created_at >= ?'); params.push(filters.startDate); }
    if (filters?.endDate) { conditions.push('created_at <= ?'); params.push(filters.endDate); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const row = this.db.get<{
      input: number; output: number; cache_r: number; cache_w: number; cost: number; cnt: number;
    }>(
      `SELECT
        COALESCE(SUM(input_tokens), 0) as input,
        COALESCE(SUM(output_tokens), 0) as output,
        COALESCE(SUM(cache_read_tokens), 0) as cache_r,
        COALESCE(SUM(cache_write_tokens), 0) as cache_w,
        COALESCE(SUM(estimated_cost_milli), 0) as cost,
        COUNT(*) as cnt
      FROM usage_tracking ${where}`,
      ...params,
    );

    return {
      totalInputTokens: row?.input ?? 0,
      totalOutputTokens: row?.output ?? 0,
      totalCacheReadTokens: row?.cache_r ?? 0,
      totalCacheWriteTokens: row?.cache_w ?? 0,
      totalCostMilli: row?.cost ?? 0,
      callCount: row?.cnt ?? 0,
    };
  }

  /** 按维度聚合统计 */
  getBreakdown(
    dimension: 'provider' | 'model' | 'agent_id' | 'channel' | 'call_type',
    filters?: { startDate?: string; endDate?: string; agentId?: string },
  ): UsageBreakdown[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.agentId) { conditions.push('agent_id = ?'); params.push(filters.agentId); }
    if (filters?.startDate) { conditions.push('created_at >= ?'); params.push(filters.startDate); }
    if (filters?.endDate) { conditions.push('created_at <= ?'); params.push(filters.endDate); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db.all<{
      dim: string; input: number; output: number; cache_r: number; cache_w: number; cost: number; cnt: number;
    }>(
      `SELECT
        ${dimension} as dim,
        COALESCE(SUM(input_tokens), 0) as input,
        COALESCE(SUM(output_tokens), 0) as output,
        COALESCE(SUM(cache_read_tokens), 0) as cache_r,
        COALESCE(SUM(cache_write_tokens), 0) as cache_w,
        COALESCE(SUM(estimated_cost_milli), 0) as cost,
        COUNT(*) as cnt
      FROM usage_tracking ${where}
      GROUP BY ${dimension}
      ORDER BY cost DESC`,
      ...params,
    );

    return rows.map(r => ({
      dimension,
      value: r.dim,
      stats: {
        totalInputTokens: r.input,
        totalOutputTokens: r.output,
        totalCacheReadTokens: r.cache_r,
        totalCacheWriteTokens: r.cache_w,
        totalCostMilli: r.cost,
        callCount: r.cnt,
      },
    }));
  }
}
