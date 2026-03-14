import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HeartbeatRunner } from '../scheduler/heartbeat-runner.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';
import { LaneQueue } from '../agent/lane-queue.js';
import type { HeartbeatConfig } from '@evoclaw/shared';

describe('HeartbeatRunner', () => {
  let db: SqliteStore;
  let laneQueue: LaneQueue;
  const agentId = 'test-agent-hb';

  beforeEach(async () => {
    db = new SqliteStore(':memory:');
    const runner = new MigrationRunner(db);
    await runner.run();
    db.run(
      "INSERT INTO agents (id, name, emoji, status, config_json, created_at, updated_at) VALUES (?, 'Test', '🤖', 'active', '{}', datetime('now'), datetime('now'))",
      agentId,
    );
    laneQueue = new LaneQueue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeConfig(overrides?: Partial<HeartbeatConfig>): HeartbeatConfig {
    return {
      intervalMinutes: 30,
      activeHours: { start: '00:00', end: '23:59' }, // 全天活跃
      enabled: true,
      ...overrides,
    };
  }

  it('应能 start 和 stop', () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig());
    expect(hb.isRunning).toBe(false);
    hb.start();
    expect(hb.isRunning).toBe(true);
    hb.stop();
    expect(hb.isRunning).toBe(false);
  });

  it('disabled 时 start 应不启动', () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig({ enabled: false }));
    hb.start();
    expect(hb.isRunning).toBe(false);
  });

  it('重复 start 应幂等', () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig());
    hb.start();
    hb.start(); // 不应创建第二个 timer
    expect(hb.isRunning).toBe(true);
    hb.stop();
  });

  it('tick 应在非活跃时段跳过', async () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig({
      activeHours: { start: '03:00', end: '04:00' },
    }));

    // Mock Date to be outside active hours (noon)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T12:00:00'));

    const result = await hb.tick();
    expect(result).toBe('skipped');

    vi.useRealTimers();
  });

  it('tick 应在活跃时段执行', async () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig({
      activeHours: { start: '00:00', end: '23:59' },
    }));

    const result = await hb.tick();
    // LaneQueue 会执行 task，返回 prompt 字符串
    // 由于 task 返回包含 prompt 而非 HEARTBEAT_OK，结果应为 'active'
    expect(['ok', 'active']).toContain(result);
  });

  it('updateConfig 应更新配置', () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig());
    const newConfig = makeConfig({ intervalMinutes: 60 });
    hb.updateConfig(newConfig);
    expect(hb.getConfig().intervalMinutes).toBe(60);
  });

  it('运行中 updateConfig 应重启', () => {
    const hb = new HeartbeatRunner(db, laneQueue, agentId, makeConfig());
    hb.start();
    expect(hb.isRunning).toBe(true);
    hb.updateConfig(makeConfig({ intervalMinutes: 10 }));
    expect(hb.isRunning).toBe(true);
    hb.stop();
  });

  it('getConfig 应返回配置副本', () => {
    const config = makeConfig();
    const hb = new HeartbeatRunner(db, laneQueue, agentId, config);
    const returned = hb.getConfig();
    expect(returned).toEqual(config);
    expect(returned).not.toBe(config); // 应是副本
  });
});
