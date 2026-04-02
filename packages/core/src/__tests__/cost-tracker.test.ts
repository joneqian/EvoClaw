import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getModelPricing, calculateCostMilli, formatCostMilli } from '../cost/model-pricing.js';
import { CostTracker } from '../cost/cost-tracker.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

function createMockDb(): SqliteStore {
  const rows: Record<string, unknown>[] = [];
  return {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockImplementation(() => {
      return { input: 1000, output: 500, cache_r: 200, cache_w: 100, cost: 5000, cnt: 3 };
    }),
    run: vi.fn().mockImplementation((...args: unknown[]) => {
      rows.push({ args });
    }),
    transaction: vi.fn((fn: () => void) => fn()),
  } as unknown as SqliteStore;
}

describe('Model Pricing', () => {
  it('精确匹配模型定价', () => {
    const pricing = getModelPricing('claude-sonnet-4-6');
    expect(pricing).not.toBeNull();
    expect(pricing!.input).toBe(3);
    expect(pricing!.output).toBe(15);
    expect(pricing!.cacheWrite).toBe(3.75);
    expect(pricing!.cacheRead).toBe(0.30);
  });

  it('前缀匹配（带日期后缀）', () => {
    const pricing = getModelPricing('claude-sonnet-4-6-20260514');
    expect(pricing).not.toBeNull();
    expect(pricing!.input).toBe(3);
  });

  it('未知模型返回 null', () => {
    expect(getModelPricing('unknown-model-xyz')).toBeNull();
  });

  it('OpenAI 模型定价', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).not.toBeNull();
    expect(pricing!.input).toBe(2.50);
  });

  it('国产模型定价', () => {
    const pricing = getModelPricing('deepseek-chat');
    expect(pricing).not.toBeNull();
    expect(pricing!.input).toBeGreaterThan(0);
  });
});

describe('Cost Calculation', () => {
  it('计算 Anthropic 模型成本（含 cache）', () => {
    // claude-sonnet-4-6: input=$3/M, output=$15/M, cacheWrite=$3.75/M, cacheRead=$0.30/M
    const cost = calculateCostMilli('claude-sonnet-4-6', 1000, 500, 200, 100);
    // input: 1000 * 3/1M = 0.003 USD
    // output: 500 * 15/1M = 0.0075 USD
    // cacheWrite: 100 * 3.75/1M = 0.000375 USD
    // cacheRead: 200 * 0.30/1M = 0.00006 USD
    // total: ~0.010935 USD → ~0.079278 CNY → ~7928 milli
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(100000); // < ¥1
  });

  it('未知模型返回 0', () => {
    expect(calculateCostMilli('unknown-model', 1000, 500)).toBe(0);
  });

  it('零 token 返回 0', () => {
    expect(calculateCostMilli('claude-sonnet-4-6', 0, 0)).toBe(0);
  });

  it('大量 token 的成本合理', () => {
    // 100K input + 50K output with Opus
    const cost = calculateCostMilli('claude-opus-4-6', 100_000, 50_000);
    // input: 100K * 15/1M = 1.5 USD, output: 50K * 75/1M = 3.75 USD
    // total: 5.25 USD → ~38.06 CNY → ~3806250 milli
    expect(cost).toBeGreaterThan(3000000);
    expect(cost).toBeLessThan(5000000);
  });
});

describe('Cost Formatting', () => {
  it('格式化为人民币', () => {
    expect(formatCostMilli(150000)).toBe('¥1.50');
    expect(formatCostMilli(15000)).toBe('¥0.150');
    expect(formatCostMilli(500)).toBe('¥0.0050');
    expect(formatCostMilli(0)).toBe('¥0.0000');
  });
});

describe('CostTracker', () => {
  let db: SqliteStore;
  let tracker: CostTracker;

  beforeEach(() => {
    db = createMockDb();
    tracker = new CostTracker(db);
  });

  it('track() 写入 DB', () => {
    tracker.track({
      agentId: 'agent-1',
      sessionKey: 'session-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      callType: 'chat',
      latencyMs: 1500,
      turnCount: 3,
    });

    expect(db.run).toHaveBeenCalledOnce();
    const args = (db.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toContain('INSERT INTO usage_tracking');
    // agent_id
    expect(args[2]).toBe('agent-1');
    // input_tokens
    expect(args[7]).toBe(1000);
    // output_tokens
    expect(args[8]).toBe(500);
  });

  it('getStats() 返回聚合结果', () => {
    const stats = tracker.getStats({ agentId: 'agent-1' });
    expect(stats.totalInputTokens).toBe(1000);
    expect(stats.totalOutputTokens).toBe(500);
    expect(stats.callCount).toBe(3);
  });

  it('getBreakdown() 按维度聚合', () => {
    (db.all as ReturnType<typeof vi.fn>).mockReturnValue([
      { dim: 'anthropic', input: 800, output: 400, cache_r: 100, cache_w: 50, cost: 3000, cnt: 2 },
      { dim: 'openai', input: 200, output: 100, cache_r: 0, cache_w: 0, cost: 500, cnt: 1 },
    ]);

    const breakdown = tracker.getBreakdown('provider');
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]!.value).toBe('anthropic');
    expect(breakdown[0]!.stats.totalInputTokens).toBe(800);
  });
});
