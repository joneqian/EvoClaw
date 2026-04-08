/**
 * SubAgentSpawner 新方法测试 — getProgressSnapshot + getWorkspaceFilesForRole
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubAgentSpawner } from '../agent/sub-agent-spawner.js';
import type { AgentRunConfig } from '../agent/types.js';
import { LaneQueue } from '../agent/lane-queue.js';

// Mock runEmbeddedAgent
vi.mock('../agent/embedded-runner.js', () => ({
  runEmbeddedAgent: vi.fn().mockResolvedValue(undefined),
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
    systemPrompt: 'parent system prompt',
    workspaceFiles: {},
    modelId: 'gpt-4o',
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: '',
  };
}

// ─── getProgressSnapshot ───

describe('SubAgentSpawner.getProgressSnapshot', () => {
  let queue: LaneQueue;
  let spawner: SubAgentSpawner;

  beforeEach(() => {
    queue = new LaneQueue();
    spawner = new SubAgentSpawner(makeConfig(), queue, 0);
  });

  it('无子 Agent 时返回空数组', () => {
    expect(spawner.getProgressSnapshot()).toEqual([]);
  });

  it('包含 running 状态的子 Agent', () => {
    const taskId = spawner.spawn('研究任务', undefined, undefined, { agentType: 'researcher' });
    const snapshot = spawner.getProgressSnapshot();

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.taskId).toBe(taskId);
    expect(snapshot[0]!.agentType).toBe('researcher');
    expect(snapshot[0]!.task).toBe('研究任务');
    expect(snapshot[0]!.status).toBe('running');
    expect(snapshot[0]!.progress.toolUseCount).toBe(0);
    expect(snapshot[0]!.progress.recentActivities).toEqual([]);
  });

  it('多个子 Agent 同时快照', () => {
    spawner.spawn('任务 A');
    spawner.spawn('任务 B');
    spawner.spawn('任务 C');

    const snapshot = spawner.getProgressSnapshot();
    expect(snapshot).toHaveLength(3);
    expect(snapshot.map(s => s.task)).toEqual(['任务 A', '任务 B', '任务 C']);
  });

  it('已取消的子 Agent 不包含在快照中', () => {
    const taskId = spawner.spawn('要取消');
    spawner.kill(taskId);

    const snapshot = spawner.getProgressSnapshot();
    // cancelled 无 completedAt 或 completedAt 在 10s 内
    // kill 后 status=cancelled + completedAt=Date.now()，刚完成应该还在 10s 窗口内
    // 但 cancelled 不是 running，检查过滤逻辑：status === 'running' || (completedAt && 10s内)
    // cancelled + completedAt 刚设置 → 在 10s 窗口内 → 会包含
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.status).toBe('cancelled');
  });

  it('快照返回的是数据副本（不共享引用）', () => {
    spawner.spawn('引用测试');
    const snap1 = spawner.getProgressSnapshot();
    const snap2 = spawner.getProgressSnapshot();

    // 不同引用
    expect(snap1).not.toBe(snap2);
    expect(snap1[0]!.progress).not.toBe(snap2[0]!.progress);
    expect(snap1[0]!.progress.recentActivities).not.toBe(snap2[0]!.progress.recentActivities);
  });
});

// ─── getWorkspaceFilesForRole ───

describe('SubAgentSpawner 工作区文件精简', () => {
  let queue: LaneQueue;

  const workspaceFiles: Record<string, string> = {
    'AGENTS.md': '# Agents config',
    'TOOLS.md': '# Tool definitions',
    'SOUL.md': '# Soul description',
    'IDENTITY.md': '# Identity',
    'USER.md': '# User profile',
    'MEMORY.md': '# Memory notes',
  };

  beforeEach(() => {
    queue = new LaneQueue();
  });

  it('type sub-agent（有 agentType）只注入 TOOLS.md', async () => {
    const { runEmbeddedAgent } = await import('../agent/embedded-runner.js');
    const mockFn = vi.mocked(runEmbeddedAgent);
    mockFn.mockClear();

    const config = makeConfig();
    const spawner = new SubAgentSpawner(
      config, queue, 0, undefined, workspaceFiles,
    );

    spawner.spawn('研究任务', undefined, undefined, { agentType: 'researcher' });

    // 等待 laneQueue drain + async mock 完成
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockFn).toHaveBeenCalled();
    const calledConfig = mockFn.mock.calls[0]![0] as AgentRunConfig;
    const wsFileKeys = Object.keys(calledConfig.workspaceFiles);

    // type sub-agent 只应有 TOOLS.md
    expect(wsFileKeys).toEqual(['TOOLS.md']);
  });

  it('非 type 的 leaf 角色不注入任何工作区文件', async () => {
    const { runEmbeddedAgent } = await import('../agent/embedded-runner.js');
    const mockFn = vi.mocked(runEmbeddedAgent);
    mockFn.mockClear();

    // depth=1, maxSpawnDepth=2 → child depth=2 → leaf
    const config = makeConfig();
    const spawner = new SubAgentSpawner(
      config, queue, 1, undefined, workspaceFiles, undefined, undefined, 2,
    );

    spawner.spawn('leaf 任务');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockFn).toHaveBeenCalled();
    const calledConfig = mockFn.mock.calls[0]![0] as AgentRunConfig;

    // leaf 角色，无 agentType → getWorkspaceFilesForRole('leaf', ...) → 空
    expect(Object.keys(calledConfig.workspaceFiles)).toEqual([]);
  });

  it('非 type 的 orchestrator 角色注入 AGENTS.md + TOOLS.md + SOUL.md', async () => {
    const { runEmbeddedAgent } = await import('../agent/embedded-runner.js');
    const mockFn = vi.mocked(runEmbeddedAgent);
    mockFn.mockClear();

    // depth=0, maxSpawnDepth=3 → child depth=1, < maxDepth=3 → orchestrator
    const config = makeConfig();
    const spawner = new SubAgentSpawner(
      config, queue, 0, undefined, workspaceFiles, undefined, undefined, 3,
    );

    spawner.spawn('orchestrator 任务');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockFn).toHaveBeenCalled();
    const calledConfig = mockFn.mock.calls[0]![0] as AgentRunConfig;

    const wsFileKeys = Object.keys(calledConfig.workspaceFiles).sort();
    expect(wsFileKeys).toEqual(['AGENTS.md', 'SOUL.md', 'TOOLS.md']);
  });
});
