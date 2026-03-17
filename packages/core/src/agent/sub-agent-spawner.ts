/**
 * 子 Agent 生命周期管理器
 * 追踪子 Agent 状态、支持 spawn/list/kill 操作
 */

import crypto from 'node:crypto';
import { runEmbeddedAgent } from './embedded-runner.js';
import type { AgentRunConfig, RuntimeEvent } from './types.js';
import type { LaneQueue } from './lane-queue.js';

/** 最大嵌套深度 */
export const MAX_SPAWN_DEPTH = 2;

/** 子 Agent 状态 */
export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 子 Agent 条目 */
export interface SubAgentEntry {
  taskId: string;
  task: string;
  status: SubAgentStatus;
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  abortController: AbortController;
}

/** 完成通知回调 */
export type OnSubAgentComplete = (taskId: string, task: string, result: string, success: boolean) => void;

/**
 * 子 Agent 生命周期管理器
 */
export class SubAgentSpawner {
  private agents = new Map<string, SubAgentEntry>();

  constructor(
    private parentConfig: AgentRunConfig,
    private laneQueue: LaneQueue,
    private currentDepth: number,
    private onComplete?: OnSubAgentComplete,
  ) {}

  /** 创建子 Agent */
  spawn(task: string, context?: string): string {
    if (this.currentDepth >= MAX_SPAWN_DEPTH) {
      throw new Error(`已达最大嵌套深度（${MAX_SPAWN_DEPTH} 层），无法继续创建子 Agent`);
    }

    const taskId = crypto.randomUUID();
    const sessionKey = `agent:${this.parentConfig.agent.id}:local:subagent:${taskId}`;
    const abortController = new AbortController();

    // 注册到活跃列表
    const entry: SubAgentEntry = {
      taskId,
      task,
      status: 'running',
      startedAt: Date.now(),
      abortController,
    };
    this.agents.set(taskId, entry);

    // 构建子 Agent 配置（minimal 模式：复用父 Agent 的模型配置，精简系统提示）
    const childConfig: AgentRunConfig = {
      agent: this.parentConfig.agent,
      systemPrompt: this.buildMinimalPrompt(task, context),
      workspaceFiles: {},  // minimal 模式不加载工作区文件
      modelId: this.parentConfig.modelId,
      provider: this.parentConfig.provider,
      apiKey: this.parentConfig.apiKey,
      baseUrl: this.parentConfig.baseUrl,
      apiProtocol: this.parentConfig.apiProtocol,
      tools: this.parentConfig.tools,  // 继承父 Agent 的工具（但不含子 Agent 工具本身）
      messages: [],  // 子 Agent 没有历史消息
    };

    // 在 subagent 车道中排队执行
    this.laneQueue.enqueue({
      id: taskId,
      sessionKey,
      lane: 'subagent',
      task: async () => {
        let result = '';
        try {
          await runEmbeddedAgent(
            childConfig,
            task,
            (event: RuntimeEvent) => {
              if (event.type === 'text_delta' && event.delta) {
                result += event.delta;
              }
            },
            abortController.signal,
          );

          entry.status = 'completed';
          entry.result = result || '（子 Agent 未返回内容）';
          entry.completedAt = Date.now();

          this.onComplete?.(taskId, task, entry.result, true);
        } catch (err) {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.completedAt = Date.now();

          this.onComplete?.(taskId, task, entry.error, false);
          // 不抛出 — 子 Agent 失败不应崩溃父 Agent
        }
      },
      timeoutMs: 120_000,
    }).catch(() => {
      // 队列层面的错误（超时等）
      if (entry.status === 'running') {
        entry.status = 'failed';
        entry.error = '子 Agent 执行超时';
        entry.completedAt = Date.now();
      }
    });

    return taskId;
  }

  /** 列出所有子 Agent 状态 */
  list(): Array<Omit<SubAgentEntry, 'abortController'>> {
    return [...this.agents.values()].map(({ abortController: _, ...rest }) => rest);
  }

  /** 终止子 Agent */
  kill(taskId: string): boolean {
    const entry = this.agents.get(taskId);
    if (!entry) return false;

    if (entry.status === 'running') {
      entry.abortController.abort();
      entry.status = 'cancelled';
      entry.completedAt = Date.now();
      return true;
    }
    return false;
  }

  /** 获取单个子 Agent 状态 */
  get(taskId: string): SubAgentEntry | undefined {
    return this.agents.get(taskId);
  }

  /** 构建子 Agent 的 minimal 系统提示 */
  private buildMinimalPrompt(task: string, context?: string): string {
    const parts: string[] = [];

    parts.push(`<role>
你是一个子 Agent，负责完成父 Agent 分配的特定任务。
专注于任务本身，完成后返回结果。不要进行额外的闲聊或偏离任务。
</role>`);

    parts.push(`<task>\n${task}\n</task>`);

    if (context) {
      parts.push(`<context>\n${context}\n</context>`);
    }

    parts.push(`<constraints>
- 你是子 Agent，不能再创建新的子 Agent
- 专注完成分配的任务，不要偏离
- 完成后简洁地返回结果
</constraints>`);

    return parts.join('\n\n');
  }
}
