import { describe, it, expect, afterEach, vi } from 'vitest';
import { HeartbeatRunner, type HeartbeatExecuteFn } from '../scheduler/heartbeat-runner.js';
import type { HeartbeatConfig } from '@evoclaw/shared';

describe('HeartbeatRunner', () => {
  const agentId = 'test-agent-hb';

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

  /** 创建 mock executeFn，默认返回 HEARTBEAT_OK */
  function mockExecuteFn(response = 'HEARTBEAT_OK'): HeartbeatExecuteFn {
    return vi.fn().mockResolvedValue(response);
  }

  it('应能 start 和 stop', () => {
    const hb = new HeartbeatRunner(agentId, makeConfig(), mockExecuteFn());
    expect(hb.isRunning).toBe(false);
    hb.start();
    expect(hb.isRunning).toBe(true);
    hb.stop();
    expect(hb.isRunning).toBe(false);
  });

  it('disabled 时 start 应不启动', () => {
    const hb = new HeartbeatRunner(agentId, makeConfig({ enabled: false }), mockExecuteFn());
    hb.start();
    expect(hb.isRunning).toBe(false);
  });

  it('重复 start 应幂等', () => {
    const hb = new HeartbeatRunner(agentId, makeConfig(), mockExecuteFn());
    hb.start();
    hb.start(); // 不应创建第二个 timer
    expect(hb.isRunning).toBe(true);
    hb.stop();
  });

  it('tick 应在非活跃时段跳过', async () => {
    const hb = new HeartbeatRunner(agentId, makeConfig({
      activeHours: { start: '03:00', end: '04:00' },
    }), mockExecuteFn());

    // Mock Date to be outside active hours (noon)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T12:00:00'));

    const result = await hb.tick();
    expect(result).toBe('skipped');

    vi.useRealTimers();
  });

  it('tick 应在活跃时段执行', async () => {
    const executeFn = mockExecuteFn('HEARTBEAT_OK');
    const hb = new HeartbeatRunner(agentId, makeConfig({
      activeHours: { start: '00:00', end: '23:59' },
    }), executeFn);

    const result = await hb.tick();
    expect(result).toBe('ok');
    expect(executeFn).toHaveBeenCalledOnce();
    expect(executeFn).toHaveBeenCalledWith(
      agentId,
      expect.stringContaining('[Heartbeat]'),
      `agent:${agentId}:heartbeat`,
    );
  });

  it('tick 应调用 executeFn 并传入正确的 prompt', async () => {
    const executeFn = mockExecuteFn('HEARTBEAT_OK');
    const hb = new HeartbeatRunner(agentId, makeConfig(), executeFn);

    await hb.tick();

    const call = (executeFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(agentId);
    expect(call[1]).toContain('HEARTBEAT.md');
    expect(call[1]).toContain('Standing Orders');
    expect(call[2]).toBe(`agent:${agentId}:heartbeat`);
  });

  it('updateConfig 应更新配置', () => {
    const hb = new HeartbeatRunner(agentId, makeConfig(), mockExecuteFn());
    const newConfig = makeConfig({ intervalMinutes: 60 });
    hb.updateConfig(newConfig);
    expect(hb.getConfig().intervalMinutes).toBe(60);
  });

  it('运行中 updateConfig 应重启', () => {
    const hb = new HeartbeatRunner(agentId, makeConfig(), mockExecuteFn());
    hb.start();
    expect(hb.isRunning).toBe(true);
    hb.updateConfig(makeConfig({ intervalMinutes: 10 }));
    expect(hb.isRunning).toBe(true);
    hb.stop();
  });

  it('getConfig 应返回配置副本', () => {
    const config = makeConfig();
    const hb = new HeartbeatRunner(agentId, config, mockExecuteFn());
    const returned = hb.getConfig();
    expect(returned).toEqual(config);
    expect(returned).not.toBe(config); // 应是副本
  });

  // ─── 零污染回滚 ───

  describe('零污染回滚', () => {
    it('HEARTBEAT_OK 响应应返回 ok', async () => {
      const executeFn = mockExecuteFn('HEARTBEAT_OK');
      const hb = new HeartbeatRunner(agentId, makeConfig(), executeFn);

      const result = await hb.tick();
      expect(result).toBe('ok');
    });

    it('NO_REPLY 响应应返回 ok', async () => {
      const executeFn = mockExecuteFn('NO_REPLY');
      const hb = new HeartbeatRunner(agentId, makeConfig(), executeFn);

      const result = await hb.tick();
      expect(result).toBe('ok');
    });

    it('实际工作内容应返回 active', async () => {
      const executeFn = mockExecuteFn('我已经检查了日程，发现明天有一个会议');
      const hb = new HeartbeatRunner(agentId, makeConfig(), executeFn);

      const result = await hb.tick();
      expect(result).toBe('active');
    });
  });

  // ─── 间隔门控 ───

  describe('间隔门控', () => {
    it('快速连续调用应被间隔门控跳过', async () => {
      const executeFn = mockExecuteFn('HEARTBEAT_OK');
      const hb = new HeartbeatRunner(agentId, makeConfig(), executeFn);

      await hb.tick(); // 第一次执行
      const result = await hb.tick(); // 第二次应被跳过

      expect(result).toBe('skipped');
      expect(executeFn).toHaveBeenCalledOnce();
    });

    it('超过最小间隔后应允许再次执行', async () => {
      const executeFn = mockExecuteFn('HEARTBEAT_OK');
      // 极短间隔 (0.001 分钟 = 60ms)
      const hb = new HeartbeatRunner(agentId, makeConfig({ minIntervalMinutes: 0.001 }), executeFn);

      await hb.tick();
      await new Promise(resolve => setTimeout(resolve, 100));
      const result = await hb.tick();

      expect(result).toBe('ok');
      expect(executeFn).toHaveBeenCalledTimes(2);
    });

    it('默认最小间隔应为 5 分钟', async () => {
      const executeFn = mockExecuteFn('HEARTBEAT_OK');
      const config = makeConfig(); // 无 minIntervalMinutes
      const hb = new HeartbeatRunner(agentId, config, executeFn);

      await hb.tick();
      // 立即再调一次 — 应被默认 5 分钟间隔挡住
      const result = await hb.tick();
      expect(result).toBe('skipped');
    });
  });

  // ─── executeFn 错误处理 ───

  describe('executeFn 错误处理', () => {
    it('executeFn 抛异常应返回 skipped', async () => {
      const executeFn = vi.fn().mockRejectedValue(new Error('LLM 超时'));
      const hb = new HeartbeatRunner(agentId, makeConfig(), executeFn);

      const result = await hb.tick();
      expect(result).toBe('skipped');
    });
  });
});
