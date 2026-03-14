import { describe, it, expect, beforeEach } from 'vitest';
import { GrowthTracker } from '../evolution/growth-tracker.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import type { GrowthEvent } from '@evoclaw/shared';

describe('GrowthTracker', () => {
  let db: SqliteStore;
  let tracker: GrowthTracker;
  const agentId = 'test-agent-001';

  beforeEach(async () => {
    db = new SqliteStore(':memory:');
    const runner = new MigrationRunner(db);
    await runner.run();
    // 确保 agent 存在（外键约束）
    db.run(
      "INSERT INTO agents (id, name, emoji, status, config_json, created_at, updated_at) VALUES (?, 'Test', '🤖', 'active', '{}', datetime('now'), datetime('now'))",
      agentId,
    );
    tracker = new GrowthTracker(db);
  });

  it('应记录成长事件', () => {
    const event: GrowthEvent = {
      type: 'capability_up',
      capability: 'coding',
      delta: 0.5,
      timestamp: new Date().toISOString(),
    };
    tracker.recordEvent(agentId, event);

    const events = tracker.getRecentEvents(agentId);
    expect(events).toHaveLength(1);
    expect(events[0].capability).toBe('coding');
    expect(events[0].delta).toBe(0.5);
  });

  it('应按时间倒序返回事件', () => {
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date(Date.now() - 1000).toISOString();
    const t3 = new Date().toISOString();

    tracker.recordEvent(agentId, { type: 'capability_up', capability: 'coding', delta: 0.1, timestamp: t1 });
    tracker.recordEvent(agentId, { type: 'capability_up', capability: 'analysis', delta: 0.2, timestamp: t2 });
    tracker.recordEvent(agentId, { type: 'new_capability', capability: 'writing', delta: 0.3, timestamp: t3 });

    const events = tracker.getRecentEvents(agentId, 2);
    expect(events).toHaveLength(2);
    expect(events[0].capability).toBe('writing');
    expect(events[1].capability).toBe('analysis');
  });

  it('应计算成长向量', () => {
    const now = new Date().toISOString();
    tracker.recordEvent(agentId, { type: 'capability_up', capability: 'coding', delta: 0.3, timestamp: now });
    tracker.recordEvent(agentId, { type: 'capability_up', capability: 'coding', delta: 0.2, timestamp: now });
    tracker.recordEvent(agentId, { type: 'capability_down', capability: 'writing', delta: -0.1, timestamp: now });

    const vector = tracker.computeGrowthVector(agentId);
    expect(vector).toHaveLength(2);

    const coding = vector.find((v) => v.dimension === 'coding');
    expect(coding).toBeDefined();
    expect(coding!.delta).toBeCloseTo(0.5);
    expect(coding!.trend).toBe('up');

    const writing = vector.find((v) => v.dimension === 'writing');
    expect(writing).toBeDefined();
    expect(writing!.delta).toBeCloseTo(-0.1);
    expect(writing!.trend).toBe('down');
  });

  it('无事件应返回空向量', () => {
    const vector = tracker.computeGrowthVector(agentId);
    expect(vector).toEqual([]);
  });

  it('应正确识别稳定趋势', () => {
    const now = new Date().toISOString();
    tracker.recordEvent(agentId, { type: 'capability_up', capability: 'data', delta: 0.005, timestamp: now });
    tracker.recordEvent(agentId, { type: 'capability_down', capability: 'data', delta: -0.005, timestamp: now });

    const vector = tracker.computeGrowthVector(agentId);
    const data = vector.find((v) => v.dimension === 'data');
    expect(data?.trend).toBe('stable');
  });
});
