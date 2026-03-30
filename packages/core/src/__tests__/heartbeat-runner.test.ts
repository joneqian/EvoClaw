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

  // ─── 零污染回滚 ───

  describe('零污染回滚', () => {
    it('HEARTBEAT_OK 响应不应写入 conversation_log', async () => {
      // LaneQueue.enqueue 执行 task() 并返回结果
      // 由于 task 返回的是 prompt 字符串而非 LLM 响应，
      // 这里 mock enqueue 直接返回 HEARTBEAT_OK 来模拟
      const mockLq = { enqueue: vi.fn().mockResolvedValue('HEARTBEAT_OK') } as any;
      const hb = new HeartbeatRunner(db, mockLq, agentId, makeConfig());

      const result = await hb.tick();
      expect(result).toBe('ok');

      // 验证 conversation_log 无新增行
      const rows = db.all(
        'SELECT * FROM conversation_log WHERE agent_id = ? AND session_key LIKE ?',
        agentId, '%heartbeat%',
      );
      expect(rows).toHaveLength(0);
    });

    it('NO_REPLY 响应应返回 ok', async () => {
      const mockLq = { enqueue: vi.fn().mockResolvedValue('NO_REPLY') } as any;
      const hb = new HeartbeatRunner(db, mockLq, agentId, makeConfig());

      const result = await hb.tick();
      expect(result).toBe('ok');
    });

    it('实际工作内容应返回 active 且不手动写 DB', async () => {
      const mockLq = { enqueue: vi.fn().mockResolvedValue('我已经检查了日程') } as any;
      const hb = new HeartbeatRunner(db, mockLq, agentId, makeConfig());

      const result = await hb.tick();
      expect(result).toBe('active');

      // 删除了冗余 INSERT 后，heartbeat-runner 不再直接写 conversation_log
      const rows = db.all(
        'SELECT * FROM conversation_log WHERE agent_id = ?',
        agentId,
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ─── 间隔门控 ───

  describe('间隔门控', () => {
    it('快速连续调用应被间隔门控跳过', async () => {
      const mockLq = { enqueue: vi.fn().mockResolvedValue('HEARTBEAT_OK') } as any;
      const hb = new HeartbeatRunner(db, mockLq, agentId, makeConfig());

      await hb.tick(); // 第一次执行
      const result = await hb.tick(); // 第二次应被跳过

      expect(result).toBe('skipped');
      expect(mockLq.enqueue).toHaveBeenCalledOnce();
    });

    it('超过最小间隔后应允许再次执行', async () => {
      const mockLq = { enqueue: vi.fn().mockResolvedValue('HEARTBEAT_OK') } as any;
      // 极短间隔 (0.001 分钟 = 60ms)
      const hb = new HeartbeatRunner(db, mockLq, agentId, makeConfig({ minIntervalMinutes: 0.001 }));

      await hb.tick();
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await hb.tick();

      expect(result).toBe('ok');
      expect(mockLq.enqueue).toHaveBeenCalledTimes(2);
    });

    it('默认最小间隔应为 5 分钟', async () => {
      const mockLq = { enqueue: vi.fn().mockResolvedValue('HEARTBEAT_OK') } as any;
      const config = makeConfig(); // 无 minIntervalMinutes
      const hb = new HeartbeatRunner(db, mockLq, agentId, config);

      await hb.tick();
      // 立即再调一次 — 应被默认 5 分钟间隔挡住
      const result = await hb.tick();
      expect(result).toBe('skipped');
    });
  });
});
