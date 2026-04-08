/**
 * SubAgentSpawner 资源清理 + 权限接入 + 结构化通知 + In-place steer 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentSpawner } from '../agent/sub-agent-spawner.js';
import type { AgentRunConfig } from '../agent/types.js';
import { LaneQueue } from '../agent/lane-queue.js';

// Mock runEmbeddedAgent — 默认立即成功
const mockRunEmbeddedAgent = vi.fn().mockResolvedValue(undefined);
vi.mock('../agent/embedded-runner.js', () => ({
  runEmbeddedAgent: (...args: unknown[]) => mockRunEmbeddedAgent(...args),
}));

function makeConfig(overrides?: Partial<AgentRunConfig>): AgentRunConfig {
  return {
    agent: {
      id: 'parent-agent',
      name: '父 Agent',
      emoji: '🤖',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    systemPrompt: '',
    workspaceFiles: {},
    modelId: 'gpt-4o',
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: '',
    ...overrides,
  };
}

// ─── Item 1: 资源清理 ───

describe('SubAgentSpawner 资源清理', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
    mockRunEmbeddedAgent.mockReset().mockResolvedValue(undefined);
  });

  it('evictCompleted 清除已通知的终态条目', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('测试任务');

    // 模拟完成
    const entry = spawner.get(taskId)!;
    entry.status = 'completed';
    entry.completedAt = Date.now() - 10 * 60 * 1000; // 10 分钟前
    entry.announced = true;
    entry.result = '大量结果文本'.repeat(100);

    const evicted = spawner.evictCompleted(5 * 60 * 1000);
    expect(evicted).toBe(1);
    expect(spawner.get(taskId)).toBeUndefined();
  });

  it('evictCompleted 不清除未通知的条目', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('测试任务');

    const entry = spawner.get(taskId)!;
    entry.status = 'completed';
    entry.completedAt = Date.now() - 10 * 60 * 1000;
    entry.announced = false; // 未通知

    const evicted = spawner.evictCompleted(5 * 60 * 1000);
    expect(evicted).toBe(0);
    expect(spawner.get(taskId)).toBeDefined();
  });

  it('evictCompleted 保留期内不清除', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('测试任务');

    const entry = spawner.get(taskId)!;
    entry.status = 'completed';
    entry.completedAt = Date.now() - 1000; // 1 秒前
    entry.announced = true;

    const evicted = spawner.evictCompleted(5 * 60 * 1000);
    expect(evicted).toBe(0); // 保留期 5 分钟内
  });

  it('dispose 清理所有条目', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('任务 1');
    spawner.spawn('任务 2');
    spawner.spawn('任务 3');

    expect(spawner.list()).toHaveLength(3);

    spawner.dispose();

    expect(spawner.list()).toHaveLength(0);
    expect(spawner.hasRunning).toBe(false);
  });

  it('cleanup 合并 idle 清理和条目驱逐', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);

    // 创建一个 idle 超时的 session 条目
    const taskId1 = spawner.spawn('session 任务', undefined, undefined, { mode: 'session' });
    const entry1 = spawner.get(taskId1)!;
    entry1.status = 'idle';
    entry1.completedAt = Date.now() - 60 * 60 * 1000; // 1 小时前

    // 创建一个已完成且已通知的条目
    const taskId2 = spawner.spawn('完成任务');
    const entry2 = spawner.get(taskId2)!;
    entry2.status = 'completed';
    entry2.completedAt = Date.now() - 10 * 60 * 1000;
    entry2.announced = true;

    const result = spawner.cleanup();
    expect(result.idleCleaned).toBe(1);
    expect(result.evicted).toBe(1);
  });

  it('collectCompletedResults 后释放 result 引用', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('测试任务');

    const entry = spawner.get(taskId)!;
    entry.status = 'completed';
    entry.result = '大量结果文本';

    const results = spawner.collectCompletedResults();
    expect(results).toHaveLength(1);
    expect(results[0]!.result).toBe('大量结果文本');

    // 原始 entry.result 应已释放
    expect(entry.result).toBeUndefined();
    expect(entry.announced).toBe(true);
  });
});

// ─── Item 2A: 权限接入 ───

describe('SubAgentSpawner 权限接入', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
    mockRunEmbeddedAgent.mockReset().mockResolvedValue(undefined);
  });

  it('permissionInterceptFn 传递到 childConfig', () => {
    const interceptFn = vi.fn().mockResolvedValue(null);
    const spawner = new SubAgentSpawner(
      makeConfig(), queue, 0,
      undefined, undefined, undefined, undefined, undefined, undefined,
      interceptFn,
    );

    spawner.spawn('需要权限的任务');

    // runEmbeddedAgent 应被调用，检查 config 中包含 permissionInterceptFn
    // 由于是异步排队，需要等待 drain
    // 但我们可以检查 mock 的调用参数
    expect(mockRunEmbeddedAgent).toHaveBeenCalled();
    const calledConfig = mockRunEmbeddedAgent.mock.calls[0]?.[0] as AgentRunConfig;
    expect(calledConfig.permissionInterceptFn).toBe(interceptFn);
  });

  it('不传 permissionInterceptFn 时 childConfig 中为 undefined', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('无权限任务');

    expect(mockRunEmbeddedAgent).toHaveBeenCalled();
    const calledConfig = mockRunEmbeddedAgent.mock.calls[0]?.[0] as AgentRunConfig;
    expect(calledConfig.permissionInterceptFn).toBeUndefined();
  });
});

// ─── Item 3: 结构化完成通知 ───

describe('SubAgentSpawner 结构化通知', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
    mockRunEmbeddedAgent.mockReset().mockResolvedValue(undefined);
  });

  it('drainStructuredAnnouncements 返回结构化通知', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('结构化任务', undefined, undefined, { agentType: 'researcher' });

    // 等待 LaneQueue drain
    await new Promise(resolve => setTimeout(resolve, 50));

    const notifications = spawner.drainStructuredAnnouncements();
    expect(notifications).toHaveLength(1);

    const n = notifications[0]!;
    expect(n.taskId).toBeTruthy();
    expect(n.task).toBe('结构化任务');
    expect(n.agentType).toBe('researcher');
    expect(n.status).toBe('completed');
    expect(n.success).toBe(true);
    expect(n.durationMs).toBeGreaterThanOrEqual(0);
    expect(n.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('drainAnnouncements 兼容旧格式', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('兼容任务');

    await new Promise(resolve => setTimeout(resolve, 50));

    const text = spawner.drainAnnouncements();
    expect(text).toContain('子 Agent 完成');
    expect(text).toContain('耗时:');
    expect(text).toContain('Tokens:');
    expect(text).toContain('成功');
  });

  it('drainStructuredAnnouncements 清空后再次调用返回空', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('一次性任务');

    await new Promise(resolve => setTimeout(resolve, 50));

    spawner.drainStructuredAnnouncements();
    const second = spawner.drainStructuredAnnouncements();
    expect(second).toHaveLength(0);
  });

  it('OnSubAgentComplete 回调包含 notification 参数', async () => {
    const onComplete = vi.fn();
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0, onComplete);
    spawner.spawn('回调任务');

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onComplete).toHaveBeenCalledWith(
      expect.any(String),      // taskId
      '回调任务',              // task
      expect.any(String),      // result
      true,                    // success
      expect.objectContaining({  // notification
        taskId: expect.any(String),
        status: 'completed',
        durationMs: expect.any(Number),
        tokenUsage: expect.any(Object),
      }),
    );
  });
});

// ─── Item 5: In-place steer ───

describe('SubAgentSpawner in-place steer', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
    mockRunEmbeddedAgent.mockReset().mockResolvedValue(undefined);
  });

  it('steer 返回原 taskId（不创建新条目）', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const originalTaskId = spawner.spawn('原始任务');

    const steeredTaskId = spawner.steer(originalTaskId, '改改方向');
    expect(steeredTaskId).toBe(originalTaskId);
  });

  it('steer 后 entry.task 包含纠偏指令', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('原始任务');

    spawner.steer(taskId, '往左边走');

    const entry = spawner.get(taskId)!;
    expect(entry.task).toContain('原始任务');
    expect(entry.task).toContain('[纠偏指令] 往左边走');
  });

  it('steer 后 progress 重置为 0', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('原始任务');

    // 模拟已有进度
    const entry = spawner.get(taskId)!;
    entry.progress.toolUseCount = 5;
    entry.progress.inputTokens = 1000;

    spawner.steer(taskId, '重新开始');

    expect(entry.progress.toolUseCount).toBe(0);
    expect(entry.progress.inputTokens).toBe(0);
    expect(entry.progress.outputTokens).toBe(0);
    expect(entry.progress.recentActivities).toEqual([]);
  });

  it('steer 后 list 长度不变', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('任务 1');
    spawner.spawn('任务 2');

    expect(spawner.list()).toHaveLength(2);

    const taskId = spawner.list()[0]!.taskId;
    spawner.steer(taskId, '纠偏');

    // 不应新增条目
    expect(spawner.list()).toHaveLength(2);
  });
});
