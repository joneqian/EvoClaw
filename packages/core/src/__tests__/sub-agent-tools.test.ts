import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentSpawner, MAX_SPAWN_DEPTH } from '../agent/sub-agent-spawner.js';
import { createSubAgentTools } from '../tools/sub-agent-tools.js';
import type { AgentRunConfig } from '../agent/types.js';
import { LaneQueue } from '../agent/lane-queue.js';

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

  it('应该返回 3 个工具', () => {
    const tools = createSubAgentTools(spawner);
    expect(tools).toHaveLength(3);
    const names = tools.map(t => t.name);
    expect(names).toContain('spawn_agent');
    expect(names).toContain('list_agents');
    expect(names).toContain('kill_agent');
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
});
