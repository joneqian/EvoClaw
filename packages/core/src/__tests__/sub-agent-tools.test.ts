import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentSpawner, MAX_SPAWN_DEPTH } from '../agent/sub-agent-spawner.js';
import { createSubAgentTools } from '../tools/sub-agent-tools.js';
import type { AgentRunConfig } from '../agent/types.js';
import { LaneQueue } from '../agent/lane-queue.js';
import { DEFAULT_MAX_SPAWN_DEPTH, degradeThinkLevel } from '@evoclaw/shared';

// Mock runEmbeddedAgent
vi.mock('../agent/embedded-runner.js', () => ({
  runEmbeddedAgent: vi.fn().mockResolvedValue(undefined),
  buildSystemPrompt: vi.fn().mockReturnValue(''),
}));

function makeConfig(): AgentRunConfig {
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
  };
}

describe('SubAgentSpawner', () => {
  let queue: LaneQueue;
  let spawner: SubAgentSpawner;

  beforeEach(() => {
    queue = new LaneQueue();
    spawner = new SubAgentSpawner(makeConfig(), queue, 0);
  });

  it('应该成功 spawn 子 Agent', () => {
    const taskId = spawner.spawn('分析代码');
    expect(taskId).toBeTruthy();
    expect(taskId.length).toBe(36); // UUID
  });

  it('list 应该返回已 spawn 的子 Agent', () => {
    spawner.spawn('任务 1');
    spawner.spawn('任务 2');
    const list = spawner.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.task).toBe('任务 1');
    expect(list[1]!.task).toBe('任务 2');
  });

  it('应该拒绝超过深度限制的 spawn', () => {
    const deepSpawner = new SubAgentSpawner(makeConfig(), queue, MAX_SPAWN_DEPTH);
    expect(() => deepSpawner.spawn('不应该成功')).toThrow('最大嵌套深度');
  });

  it('kill 应该取消运行中的子 Agent', () => {
    const taskId = spawner.spawn('要取消的任务');
    const killed = spawner.kill(taskId);
    expect(killed).toBe(true);

    const entry = spawner.get(taskId);
    expect(entry?.status).toBe('cancelled');
  });

  it('kill 不存在的 taskId 应返回 false', () => {
    expect(spawner.kill('nonexistent')).toBe(false);
  });

  it('get 不存在的 taskId 应返回 undefined', () => {
    expect(spawner.get('nonexistent')).toBeUndefined();
  });

  it('应该调用 onComplete 回调', async () => {
    const onComplete = vi.fn();
    const spawnerWithCallback = new SubAgentSpawner(makeConfig(), queue, 0, onComplete);

    spawnerWithCallback.spawn('回调测试');

    // 等待异步执行
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(onComplete).toHaveBeenCalledWith(
      expect.any(String),     // taskId
      '回调测试',              // task
      expect.any(String),     // result
      true,                    // success
      expect.objectContaining({  // notification (结构化通知)
        status: 'completed',
        success: true,
        durationMs: expect.any(Number),
      }),
    );
  });
});

describe('子 Agent 工具集', () => {
  let queue: LaneQueue;
  let spawner: SubAgentSpawner;

  beforeEach(() => {
    queue = new LaneQueue();
    spawner = new SubAgentSpawner(makeConfig(), queue, 0);
  });

  it('应该返回 7 个工具', () => {
    const tools = createSubAgentTools(spawner);
    expect(tools).toHaveLength(7);
    const names = tools.map(t => t.name);
    expect(names).toContain('decompose_task');
    expect(names).toContain('spawn_agent');
    expect(names).toContain('list_agents');
    expect(names).toContain('kill_agent');
    expect(names).toContain('steer_agent');
    expect(names).toContain('resume_agent');
    expect(names).toContain('yield_agents');
  });

  it('spawn_agent 缺少 task 应返回错误', async () => {
    const tools = createSubAgentTools(spawner);
    const spawnTool = tools.find(t => t.name === 'spawn_agent')!;
    const result = await spawnTool.execute({});
    expect(result).toContain('错误');
  });

  it('spawn_agent 应该成功创建子 Agent', async () => {
    const tools = createSubAgentTools(spawner);
    const spawnTool = tools.find(t => t.name === 'spawn_agent')!;
    const result = await spawnTool.execute({ task: '分析代码' });
    expect(result).toContain('已启动');
    expect(result).toContain('Task ID');
  });

  it('list_agents 无子 Agent 时应返回提示', async () => {
    const tools = createSubAgentTools(spawner);
    const listTool = tools.find(t => t.name === 'list_agents')!;
    const result = await listTool.execute({});
    expect(result).toContain('没有');
  });

  it('list_agents 有子 Agent 时应返回状态', async () => {
    const tools = createSubAgentTools(spawner);
    spawner.spawn('任务 A');
    const listTool = tools.find(t => t.name === 'list_agents')!;
    const result = await listTool.execute({});
    expect(result).toContain('任务 A');
    expect(result).toContain('共 1 个');
  });

  it('kill_agent 缺少 taskId 应返回错误', async () => {
    const tools = createSubAgentTools(spawner);
    const killTool = tools.find(t => t.name === 'kill_agent')!;
    const result = await killTool.execute({});
    expect(result).toContain('错误');
  });

  it('kill_agent 不存在的 taskId 应返回提示', async () => {
    const tools = createSubAgentTools(spawner);
    const killTool = tools.find(t => t.name === 'kill_agent')!;
    const result = await killTool.execute({ taskId: 'nonexistent' });
    expect(result).toContain('未找到');
  });

  it('深度限制应阻止 spawn', async () => {
    const deepSpawner = new SubAgentSpawner(makeConfig(), queue, MAX_SPAWN_DEPTH);
    const tools = createSubAgentTools(deepSpawner);
    const spawnTool = tools.find(t => t.name === 'spawn_agent')!;
    const result = await spawnTool.execute({ task: '不应成功' });
    expect(result).toContain('失败');
    expect(result).toContain('嵌套深度');
  });

  it('resume_agent 缺少参数应返回错误', async () => {
    const tools = createSubAgentTools(spawner);
    const resumeTool = tools.find(t => t.name === 'resume_agent')!;
    expect(await resumeTool.execute({})).toContain('错误');
    expect(await resumeTool.execute({ taskId: 'abc' })).toContain('错误');
  });

  it('resume_agent 对不存在的 taskId 应返回失败', async () => {
    const tools = createSubAgentTools(spawner);
    const resumeTool = tools.find(t => t.name === 'resume_agent')!;
    const result = await resumeTool.execute({ taskId: 'nonexistent', followUp: '继续' });
    expect(result).toContain('恢复失败');
  });
});

// ─── Sprint 15 新增测试 ───

describe('Sprint 15.1: 可配置嵌套深度', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
  });

  it('默认 maxSpawnDepth 应为 DEFAULT_MAX_SPAWN_DEPTH (2)', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    expect(spawner.maxSpawnDepth).toBe(DEFAULT_MAX_SPAWN_DEPTH);
    expect(spawner.maxSpawnDepth).toBe(2);
  });

  it('自定义 maxSpawnDepth=3 应允许 3 级嵌套', () => {
    // depth=2 + maxSpawnDepth=3 → 还能 spawn
    const spawner = new SubAgentSpawner(makeConfig(), queue, 2, undefined, undefined, undefined, undefined, 3);
    expect(spawner.maxSpawnDepth).toBe(3);
    const taskId = spawner.spawn('3 级嵌套任务');
    expect(taskId).toBeTruthy();
  });

  it('自定义 maxSpawnDepth=3，depth=3 应拒绝', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 3, undefined, undefined, undefined, undefined, 3);
    expect(() => spawner.spawn('不应成功')).toThrow('最大嵌套深度（3 层）');
  });

  it('默认 maxSpawnDepth=2，depth=2 应拒绝', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 2);
    expect(() => spawner.spawn('不应成功')).toThrow('最大嵌套深度（2 层）');
  });
});

describe('Sprint 15.3: ThinkLevel 渐进降级', () => {
  it('high → medium → low → off 逐级降级', () => {
    expect(degradeThinkLevel('high')).toBe('medium');
    expect(degradeThinkLevel('medium')).toBe('low');
    expect(degradeThinkLevel('low')).toBe('off');
    expect(degradeThinkLevel('off')).toBe('off');
  });

  it('off 已是最低，继续降级仍为 off', () => {
    expect(degradeThinkLevel('off')).toBe('off');
  });
});

describe('Sprint 15.5: 级联 Kill', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
  });

  it('kill 应该级联终止有 childSpawner 的子代', () => {
    const parentSpawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = parentSpawner.spawn('父任务');

    // 模拟子代有自己的 spawner，其中有运行中的孙代
    const childQueue = new LaneQueue();
    const childSpawner = new SubAgentSpawner(makeConfig(), childQueue, 1);
    const grandchildId = childSpawner.spawn('孙代任务');

    // 注入 childSpawner 到 entry
    const entry = parentSpawner.get(taskId)!;
    entry.childSpawner = childSpawner;

    // kill 父代
    parentSpawner.kill(taskId);

    // 父代和孙代都应该被终止
    expect(entry.status).toBe('cancelled');
    expect(childSpawner.get(grandchildId)?.status).toBe('cancelled');
  });

  it('killAll 应终止所有运行中的子 Agent', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const id1 = spawner.spawn('任务 1');
    const id2 = spawner.spawn('任务 2');
    const id3 = spawner.spawn('任务 3');

    spawner.killAll();

    expect(spawner.get(id1)?.status).toBe('cancelled');
    expect(spawner.get(id2)?.status).toBe('cancelled');
    expect(spawner.get(id3)?.status).toBe('cancelled');
  });

  it('kill idle 状态的 session 模式子代应成功', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 任务', undefined, undefined, { mode: 'session' });

    // 模拟进入 idle 状态
    const entry = spawner.get(taskId)!;
    entry.status = 'idle';

    const killed = spawner.kill(taskId);
    expect(killed).toBe(true);
    expect(entry.status).toBe('cancelled');
  });
});

describe('Sprint 15.6: Push-based 子代结果通知', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
  });

  it('子代完成后 pendingAnnouncements 应有通知', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('通知测试');

    // 等待异步执行完成
    await new Promise(resolve => setTimeout(resolve, 100));

    const announcements = spawner.drainAnnouncements();
    expect(announcements).not.toBeNull();
    expect(announcements).toContain('子 Agent 完成');
    expect(announcements).toContain('成功');
  });

  it('drainAnnouncements 读取后应清空', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    spawner.spawn('清空测试');

    await new Promise(resolve => setTimeout(resolve, 100));

    // 第一次读取有内容
    expect(spawner.drainAnnouncements()).not.toBeNull();
    // 第二次应为 null
    expect(spawner.drainAnnouncements()).toBeNull();
  });

  it('无完成任务时 drainAnnouncements 应返回 null', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    expect(spawner.drainAnnouncements()).toBeNull();
  });
});

describe('Sprint 15.7: Session 模式', () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue();
  });

  it('spawn mode=session 的子代应标记为 session 模式', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 任务', undefined, undefined, { mode: 'session' });
    const entry = spawner.get(taskId)!;
    expect(entry.mode).toBe('session');
  });

  it('spawn 默认 mode 应为 run', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('普通任务');
    const entry = spawner.get(taskId)!;
    expect(entry.mode).toBe('run');
  });

  it('resume 非 session 模式子代应抛出错误', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('run 模式任务');
    const entry = spawner.get(taskId)!;
    entry.status = 'idle' as any;
    expect(() => spawner.resume(taskId, '继续')).toThrow('不是 session 模式');
  });

  it('resume 非 idle 状态的 session 子代应抛出错误', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 任务', undefined, undefined, { mode: 'session' });
    // status 仍为 running
    expect(() => spawner.resume(taskId, '继续')).toThrow('仅 idle 状态');
  });

  it('resume 不存在的 taskId 应抛出错误', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    expect(() => spawner.resume('nonexistent', '继续')).toThrow('未找到');
  });

  it('session 模式子代完成后应进入 idle 状态', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 完成测试', undefined, undefined, { mode: 'session' });

    await new Promise(resolve => setTimeout(resolve, 100));

    const entry = spawner.get(taskId)!;
    expect(entry.status).toBe('idle');
  });

  it('resume idle 状态的 session 子代应成功', async () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 任务', undefined, undefined, { mode: 'session' });

    await new Promise(resolve => setTimeout(resolve, 100));

    // 现在应该是 idle
    const entry = spawner.get(taskId)!;
    expect(entry.status).toBe('idle');

    // resume
    spawner.resume(taskId, '继续分析');
    expect(entry.status).toBe('running');
  });

  it('cleanupIdleSessions 应清理超时的 idle session', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 清理测试', undefined, undefined, { mode: 'session' });

    const entry = spawner.get(taskId)!;
    entry.status = 'idle';
    entry.completedAt = Date.now() - 31 * 60 * 1000; // 31 分钟前

    const cleaned = spawner.cleanupIdleSessions();
    expect(cleaned).toBe(1);
    expect(entry.status).toBe('cancelled');
  });

  it('cleanupIdleSessions 不应清理未超时的 idle session', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session 未超时', undefined, undefined, { mode: 'session' });

    const entry = spawner.get(taskId)!;
    entry.status = 'idle';
    entry.completedAt = Date.now() - 5 * 60 * 1000; // 5 分钟前

    const cleaned = spawner.cleanupIdleSessions();
    expect(cleaned).toBe(0);
    expect(entry.status).toBe('idle');
  });

  it('steer session 模式 idle 子代应使用 resume', () => {
    const spawner = new SubAgentSpawner(makeConfig(), queue, 0);
    const taskId = spawner.spawn('session steer', undefined, undefined, { mode: 'session' });

    const entry = spawner.get(taskId)!;
    entry.status = 'idle';
    entry.completedAt = Date.now();

    const newTaskId = spawner.steer(taskId, '换个方向');
    // session 模式的 steer 返回原 taskId（因为用 resume）
    expect(newTaskId).toBe(taskId);
    expect(entry.status).toBe('running');
  });
});

// ─── decompose_task 工具测试 ───

describe('decompose_task 工具', () => {
  let queue: LaneQueue;
  let spawner: SubAgentSpawner;

  beforeEach(() => {
    queue = new LaneQueue();
    spawner = new SubAgentSpawner(makeConfig(), queue, 0);
  });

  it('应成功创建多个并行子 Agent', async () => {
    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    const result = await decompose.execute({
      subtasks: [
        { task: '搜索竞品信息', subagent_type: 'researcher' },
        { task: '分析销售数据', subagent_type: 'analyst' },
        { task: '撰写报告', subagent_type: 'writer' },
      ],
    });

    expect(result).toContain('3 个子 Agent 已启动');
    expect(result).toContain('[researcher]');
    expect(result).toContain('[analyst]');
    expect(result).toContain('[writer]');
    // mock runEmbeddedAgent 立即完成，activeCount 可能已降为 0
    // 验证 list 中有 3 条记录即可
    expect(spawner.list()).toHaveLength(3);
  });

  it('空 subtasks 应返回错误', async () => {
    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    const result = await decompose.execute({ subtasks: [] });
    expect(result).toContain('错误');
  });

  it('缺少 subtasks 应返回错误', async () => {
    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    const result = await decompose.execute({});
    expect(result).toContain('错误');
  });

  it('超过 5 个子任务应返回错误', async () => {
    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    const subtasks = Array.from({ length: 6 }, (_, i) => ({
      task: `任务 ${i + 1}`,
    }));
    const result = await decompose.execute({ subtasks });
    expect(result).toContain('最多 5 个');
  });

  it('默认 subagent_type 为 general', async () => {
    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    const result = await decompose.execute({
      subtasks: [
        { task: '通用任务' },
      ],
    });

    expect(result).toContain('[general]');
    expect(result).toContain('1 个子 Agent 已启动');
  });

  it('部分 spawn 失败时应报告成功和失败数', async () => {
    // 先占满子 Agent 额度（最多 5 个）
    for (let i = 0; i < 4; i++) {
      spawner.spawn(`占位任务 ${i}`);
    }
    expect(spawner.activeCount).toBe(4);

    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    // 尝试创建 3 个 → 只有 1 个能成功（第 5 个），其余超限
    const result = await decompose.execute({
      subtasks: [
        { task: '应成功', subagent_type: 'researcher' },
        { task: '应失败 1', subagent_type: 'writer' },
        { task: '应失败 2', subagent_type: 'analyst' },
      ],
    });

    expect(result).toContain('1 个子 Agent 已启动');
    expect(result).toContain('2 个失败');
    expect(result).toContain('最大子代数');
  });

  it('context 参数应传递给子 Agent', async () => {
    const tools = createSubAgentTools(spawner);
    const decompose = tools.find(t => t.name === 'decompose_task')!;

    const result = await decompose.execute({
      subtasks: [
        { task: '带上下文的任务', context: '额外上下文信息', subagent_type: 'researcher' },
      ],
    });

    // decompose_task 调用 spawner.spawn(task, context, ...)
    // spawn 是异步的，但 spawner.list() 同步可见
    expect(result).toContain('1 个子 Agent 已启动');
    const list = spawner.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.task).toBe('带上下文的任务');
  });
});

// ─── yield_agents 阻塞等待测试 ───

/**
 * 手动注入一个 "永远运行中" 的 entry（不经过 LaneQueue 自动完成）
 * 用于测试阻塞等待场景，避免 mock runEmbeddedAgent 立即 resolve 的干扰。
 */
function injectRunningEntry(spawner: SubAgentSpawner, taskId: string, task: string): any {
  const entry = {
    taskId,
    task,
    status: 'running' as const,
    startedAt: Date.now(),
    abortController: new AbortController(),
    announced: false,
    mode: 'run' as const,
    progress: { toolUseCount: 0, inputTokens: 0, outputTokens: 0, recentActivities: [] },
  };
  (spawner as any).agents.set(taskId, entry);
  return entry;
}

describe('SubAgentSpawner.awaitNextCompletion', () => {
  let queue: LaneQueue;
  let spawner: SubAgentSpawner;

  beforeEach(() => {
    queue = new LaneQueue();
    spawner = new SubAgentSpawner(makeConfig(), queue, 0);
  });

  it('无运行中子 Agent 时立即返回', async () => {
    const start = Date.now();
    await spawner.awaitNextCompletion({ maxWaitMs: 5000 });
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('已有未读取的完成结果时立即返回', async () => {
    const entry = injectRunningEntry(spawner, 'task-1', '已完成任务');
    entry.status = 'completed';
    entry.result = '结果';

    const start = Date.now();
    await spawner.awaitNextCompletion({ maxWaitMs: 5000 });
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('子 Agent 完成时唤醒 await', async () => {
    const entry = injectRunningEntry(spawner, 'task-2', '等待测试任务');

    const waitPromise = spawner.awaitNextCompletion({ maxWaitMs: 5000 });

    // 20ms 后模拟子 Agent 完成
    setTimeout(() => {
      entry.status = 'completed';
      entry.result = '结果';
      entry.completedAt = Date.now();
      (spawner as any).notifyWaiters();
    }, 20);

    const start = Date.now();
    await waitPromise;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(10);
    expect(elapsed).toBeLessThan(200);
  });

  it('超时后 resolve 空（不抛异常）', async () => {
    injectRunningEntry(spawner, 'task-3', '永不完成任务');

    const start = Date.now();
    await spawner.awaitNextCompletion({ maxWaitMs: 100 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(250);
  });

  it('AbortSignal 取消时抛 AbortError', async () => {
    injectRunningEntry(spawner, 'task-4', '可取消任务');

    const controller = new AbortController();
    const waitPromise = spawner.awaitNextCompletion({
      maxWaitMs: 5000,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    await expect(waitPromise).rejects.toThrow(/aborted/i);
  });

  it('已取消的 signal 立即抛 AbortError', async () => {
    injectRunningEntry(spawner, 'task-5', '任务');

    const controller = new AbortController();
    controller.abort();

    await expect(
      spawner.awaitNextCompletion({ maxWaitMs: 5000, signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
  });

  it('kill 子 Agent 时唤醒 await', async () => {
    injectRunningEntry(spawner, 'task-6', '可 kill 任务');

    const waitPromise = spawner.awaitNextCompletion({ maxWaitMs: 5000 });
    setTimeout(() => spawner.kill('task-6'), 20);

    const start = Date.now();
    await waitPromise;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(10);
    expect(elapsed).toBeLessThan(200);
  });

  it('多个同时等待的 waiter 都能被一次完成唤醒', async () => {
    const entry = injectRunningEntry(spawner, 'task-7', '多 waiter 任务');

    const p1 = spawner.awaitNextCompletion({ maxWaitMs: 5000 });
    const p2 = spawner.awaitNextCompletion({ maxWaitMs: 5000 });
    const p3 = spawner.awaitNextCompletion({ maxWaitMs: 5000 });

    setTimeout(() => {
      entry.status = 'completed';
      entry.result = 'ok';
      entry.completedAt = Date.now();
      (spawner as any).notifyWaiters();
    }, 20);

    const start = Date.now();
    await Promise.all([p1, p2, p3]);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('dispose 时唤醒所有 waiter', async () => {
    injectRunningEntry(spawner, 'task-8', 'dispose 唤醒测试');

    const waitPromise = spawner.awaitNextCompletion({ maxWaitMs: 5000 });
    setTimeout(() => spawner.dispose(), 20);

    // dispose 触发 notifyWaiters，waiter 应 resolve（不 reject）
    await expect(waitPromise).resolves.toBeUndefined();
  });
});

describe('yield_agents 工具（阻塞等待）', () => {
  let queue: LaneQueue;
  let spawner: SubAgentSpawner;

  beforeEach(() => {
    queue = new LaneQueue();
    spawner = new SubAgentSpawner(makeConfig(), queue, 0);
  });

  it('无运行中子 Agent 时立即返回提示', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;
    const result = await yieldTool.execute({});
    expect(result).toContain('没有运行中的子 Agent');
  });

  it('已有完成结果时立即返回不阻塞', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    const entry = injectRunningEntry(spawner, 'yield-1', '已完成');
    entry.status = 'completed';
    entry.result = '结果内容';

    const start = Date.now();
    const result = await yieldTool.execute({});
    expect(Date.now() - start).toBeLessThan(50);
    expect(result).toContain('子 Agent 结果推送');
    expect(result).toContain('结果内容');
  });

  it('阻塞等待到子 Agent 完成后返回', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    const entry = injectRunningEntry(spawner, 'yield-2', '等待测试');

    // 30ms 后模拟完成
    setTimeout(() => {
      entry.status = 'completed';
      entry.result = '成功结果';
      entry.completedAt = Date.now();
      (spawner as any).notifyWaiters();
    }, 30);

    const start = Date.now();
    const result = await yieldTool.execute({ max_wait_seconds: 5 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(500);
    expect(result).toContain('子 Agent 结果推送');
    expect(result).toContain('成功结果');
  });

  it('超时后返回继续等待指引（不是错误）', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    injectRunningEntry(spawner, 'yield-3', '永不完成');

    // Mock awaitNextCompletion 立即 resolve（模拟超时），避免真等 5s
    const origAwait = spawner.awaitNextCompletion.bind(spawner);
    spawner.awaitNextCompletion = vi.fn().mockResolvedValue(undefined) as any;

    const result = await yieldTool.execute({ max_wait_seconds: 5 });

    spawner.awaitNextCompletion = origAwait;

    expect(result).toContain('阻塞等待');
    expect(result).toContain('仍在运行中');
    expect(result).toContain('再次调用 yield_agents');
    expect(result).toContain('不要改用 list_agents');
    expect(spawner.get('yield-3')!.status).toBe('running');
  });

  it('max_wait_seconds 被 clamp 到 [5, 120] 范围', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    injectRunningEntry(spawner, 'yield-4', 'clamp 测试');

    let capturedMaxWaitMs = -1;
    spawner.awaitNextCompletion = (async (opts: { maxWaitMs: number }) => {
      capturedMaxWaitMs = opts.maxWaitMs;
    }) as any;

    // 太小 → clamp 到 5 秒
    await yieldTool.execute({ max_wait_seconds: 1 });
    expect(capturedMaxWaitMs).toBe(5000);

    // 太大 → clamp 到 120 秒
    await yieldTool.execute({ max_wait_seconds: 500 });
    expect(capturedMaxWaitMs).toBe(120_000);

    // 默认值 30 秒
    await yieldTool.execute({});
    expect(capturedMaxWaitMs).toBe(30_000);
  });

  it('AbortSignal 触发时返回"等待被中断"', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    injectRunningEntry(spawner, 'yield-5', 'abort 测试');

    const controller = new AbortController();
    const execPromise = yieldTool.execute(
      { max_wait_seconds: 10 },
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 20);
    const result = await execPromise;
    expect(result).toContain('等待被中断');
  });

  it('返回文本包含明确的继续等待指引（有完成+有运行中）', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    const e1 = injectRunningEntry(spawner, 'yield-6a', '任务 A');
    e1.status = 'completed';
    e1.result = '结果 A';
    injectRunningEntry(spawner, 'yield-6b', '任务 B');
    // 任务 B 仍在运行

    const result = await yieldTool.execute({});
    expect(result).toContain('结果 A');
    expect(result).toContain('仍有');
    expect(result).toContain('再次调用 yield_agents');
    expect(spawner.get('yield-6b')!.status).toBe('running');
  });

  it('所有子 Agent 完成时返回"所有子 Agent 已完成"', async () => {
    const tools = createSubAgentTools(spawner);
    const yieldTool = tools.find(t => t.name === 'yield_agents')!;

    const entry = injectRunningEntry(spawner, 'yield-7', '独任务');
    entry.status = 'completed';
    entry.result = '最终结果';

    const result = await yieldTool.execute({});
    expect(result).toContain('所有子 Agent 已完成');
  });
});
