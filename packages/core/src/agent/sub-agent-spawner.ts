/**
 * 子 Agent 生命周期管理器
 * 追踪子 Agent 状态、支持 spawn/list/kill/steer 操作
 * 参考 OpenClaw subagent-spawn.ts 架构设计
 */

import crypto from 'node:crypto';
import { runEmbeddedAgent } from './embedded-runner.js';
import type { AgentRunConfig, RuntimeEvent } from './types.js';
import type { LaneQueue } from './lane-queue.js';
import type { AgentConfig } from '@evoclaw/shared';

/** 附件 */
export interface SpawnAttachment {
  name: string;
  content: string;
}

/** 跨 Agent 解析回调：根据 agentId 返回目标 Agent 配置 + 工作区文件 */
export type AgentResolver = (agentId: string) => {
  agent: AgentConfig;
  workspaceFiles: Record<string, string>;
} | undefined;

/** 最大嵌套深度（main=0, orchestrator=1, leaf=2） */
export const MAX_SPAWN_DEPTH = 2;

/** 每 Agent 最大同时活跃子代数 */
export const MAX_CHILDREN_PER_AGENT = 5;

/** 子 Agent 默认超时（300 秒） */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 300_000;

/** 子 Agent 结果不可信标记（防提示注入） */
const UNTRUSTED_BEGIN = '<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>';
const UNTRUSTED_END = '<<<END_UNTRUSTED_CHILD_RESULT>>>';

/** 子 Agent 不应获得的工具（安全降权） */
const DENIED_TOOLS_FOR_ALL_CHILDREN = new Set([
  'memory_search',    // 信息应在 spawn prompt 中传递
  'memory_get',       // 同上
  'knowledge_query',  // 同上
]);

/** leaf 子 Agent 额外拒绝的工具（不能再生成/管理子代） */
const DENIED_TOOLS_FOR_LEAF = new Set([
  'spawn_agent',
  'list_agents',
  'kill_agent',
  'steer_agent',
  'yield_agents',
]);

/** 子 Agent 状态 */
export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 子 Agent 角色（参考 OpenClaw 三层角色） */
export type SubAgentRole = 'main' | 'orchestrator' | 'leaf';

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
  /** 结果是否已被父 Agent 读取 */
  announced: boolean;
}

/** 完成通知回调 */
export type OnSubAgentComplete = (taskId: string, task: string, result: string, success: boolean) => void;

/** 根据深度确定角色 */
function resolveRole(depth: number): SubAgentRole {
  if (depth === 0) return 'main';
  if (depth < MAX_SPAWN_DEPTH) return 'orchestrator';
  return 'leaf';
}

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
    private parentWorkspaceFiles?: Record<string, string>,
    /** 跨 Agent 解析器（可选，用于跨 Agent 生成） */
    private agentResolver?: AgentResolver,
    /** 允许跨 Agent 生成的 Agent ID 白名单（空数组=禁止，undefined=全部允许） */
    private allowAgents?: string[],
  ) {}

  /** 当前活跃子 Agent 数量 */
  get activeCount(): number {
    let count = 0;
    for (const entry of this.agents.values()) {
      if (entry.status === 'running') count++;
    }
    return count;
  }

  /** 创建子 Agent */
  spawn(task: string, context?: string, timeoutMs?: number, options?: {
    /** 跨 Agent 生成：目标 Agent ID（默认使用当前 Agent） */
    agentId?: string;
    /** 附件：传递给子 Agent 的文件内容 */
    attachments?: SpawnAttachment[];
  }): string {
    if (this.currentDepth >= MAX_SPAWN_DEPTH) {
      throw new Error(`已达最大嵌套深度（${MAX_SPAWN_DEPTH} 层），无法继续创建子 Agent`);
    }

    // 子代数量限制
    if (this.activeCount >= MAX_CHILDREN_PER_AGENT) {
      throw new Error(`已达每 Agent 最大子代数（${MAX_CHILDREN_PER_AGENT} 个），请等待现有子 Agent 完成或终止后再创建`);
    }

    // 跨 Agent 生成：解析目标 Agent
    const targetAgentId = options?.agentId;
    let targetAgent = this.parentConfig.agent;
    let targetWorkspaceFiles = this.parentWorkspaceFiles ?? {};

    if (targetAgentId && targetAgentId !== this.parentConfig.agent.id) {
      // 白名单检查
      if (this.allowAgents && !this.allowAgents.includes(targetAgentId)) {
        throw new Error(`不允许跨 Agent 生成到 "${targetAgentId}"，不在白名单中`);
      }
      // 解析目标 Agent
      if (!this.agentResolver) {
        throw new Error('跨 Agent 生成需要 agentResolver，但未配置');
      }
      const resolved = this.agentResolver(targetAgentId);
      if (!resolved) {
        throw new Error(`目标 Agent "${targetAgentId}" 不存在`);
      }
      targetAgent = resolved.agent;
      targetWorkspaceFiles = resolved.workspaceFiles;
    }

    const taskId = crypto.randomUUID();
    const sessionKey = `agent:${targetAgent.id}:local:subagent:${taskId}`;
    const abortController = new AbortController();

    // 注册到活跃列表
    const entry: SubAgentEntry = {
      taskId,
      task,
      status: 'running',
      startedAt: Date.now(),
      abortController,
      announced: false,
    };
    this.agents.set(taskId, entry);

    // 确定子 Agent 角色
    const childDepth = this.currentDepth + 1;
    const childRole = resolveRole(childDepth);

    // 工具降权：过滤掉子 Agent 不应获得的工具
    const filteredTools = (this.parentConfig.tools ?? []).filter(tool => {
      if (DENIED_TOOLS_FOR_ALL_CHILDREN.has(tool.name)) return false;
      if (childRole === 'leaf' && DENIED_TOOLS_FOR_LEAF.has(tool.name)) return false;
      return true;
    });

    // 构建子 Agent 配置
    const childConfig: AgentRunConfig = {
      agent: targetAgent,
      systemPrompt: this.buildMinimalPrompt(task, context, childRole, options?.attachments),
      workspaceFiles: {
        // 继承目标 Agent 的操作规程和工具说明
        ...(targetWorkspaceFiles['AGENTS.md'] ? { 'AGENTS.md': targetWorkspaceFiles['AGENTS.md'] } : {}),
        ...(targetWorkspaceFiles['TOOLS.md'] ? { 'TOOLS.md': targetWorkspaceFiles['TOOLS.md'] } : {}),
      },
      modelId: this.parentConfig.modelId,
      provider: this.parentConfig.provider,
      apiKey: this.parentConfig.apiKey,
      baseUrl: this.parentConfig.baseUrl,
      apiProtocol: this.parentConfig.apiProtocol,
      tools: filteredTools,
      messages: [],  // 子 Agent 没有历史消息
    };

    // 计算超时
    const effectiveTimeout = timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS;

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
          // 包裹不可信标记（防提示注入）
          const rawResult = result || '（子 Agent 未返回内容）';
          entry.result = `${UNTRUSTED_BEGIN}\n${rawResult}\n${UNTRUSTED_END}`;
          entry.completedAt = Date.now();

          this.onComplete?.(taskId, task, entry.result, true);
        } catch (err) {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.completedAt = Date.now();

          this.onComplete?.(taskId, task, entry.error ?? '', false);
          // 不抛出 — 子 Agent 失败不应崩溃父 Agent
        }
      },
      timeoutMs: effectiveTimeout,
    }).catch(() => {
      // 队列层面的错误（超时等）
      if (entry.status === 'running') {
        entry.status = 'failed';
        entry.error = `子 Agent 执行超时（${Math.round(effectiveTimeout / 1000)}s）`;
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

  /**
   * 纠偏子 Agent（steer）
   * 终止当前运行 → 用原始任务 + 部分结果 + 纠正消息重新生成
   */
  steer(taskId: string, correction: string): string {
    const entry = this.agents.get(taskId);
    if (!entry) {
      throw new Error(`未找到 Task ID 为 ${taskId} 的子 Agent`);
    }
    if (entry.status !== 'running') {
      throw new Error(`子 Agent ${taskId} 当前状态为 "${entry.status}"，仅运行中的子 Agent 可以纠偏`);
    }

    // 终止当前运行
    entry.abortController.abort();
    entry.status = 'cancelled';
    entry.completedAt = Date.now();

    // 用原始任务 + 纠正消息重新生成
    const steeredTask = `${entry.task}\n\n[纠偏指令] ${correction}`;
    const newTaskId = this.spawn(steeredTask);
    return newTaskId;
  }

  /**
   * 获取未通知的已完成结果（auto-announce 模式）
   * 返回后标记为已通知
   */
  collectCompletedResults(): Array<{ taskId: string; task: string; result: string; success: boolean }> {
    const results: Array<{ taskId: string; task: string; result: string; success: boolean }> = [];

    for (const entry of this.agents.values()) {
      if (entry.announced) continue;
      if (entry.status === 'completed') {
        results.push({
          taskId: entry.taskId,
          task: entry.task,
          result: entry.result ?? '',
          success: true,
        });
        entry.announced = true;
      } else if (entry.status === 'failed') {
        results.push({
          taskId: entry.taskId,
          task: entry.task,
          result: entry.error ?? '未知错误',
          success: false,
        });
        entry.announced = true;
      }
    }

    return results;
  }

  /** 是否有子 Agent 正在运行 */
  get hasRunning(): boolean {
    for (const entry of this.agents.values()) {
      if (entry.status === 'running') return true;
    }
    return false;
  }

  /** 构建子 Agent 的 minimal 系统提示 */
  private buildMinimalPrompt(task: string, context?: string, role?: SubAgentRole, attachments?: SpawnAttachment[]): string {
    const parts: string[] = [];

    parts.push(`<role>
你是一个子 Agent，负责完成父 Agent 分配的特定任务。
专注于任务本身，完成后返回结果。不要进行额外的闲聊或偏离任务。
</role>`);

    parts.push(`<task>\n${task}\n</task>`);

    if (context) {
      parts.push(`<context>\n${context}\n</context>`);
    }

    // 附件注入
    if (attachments && attachments.length > 0) {
      const attachmentLines = attachments.map(a =>
        `### ${a.name}\n\`\`\`\n${a.content}\n\`\`\``
      ).join('\n\n');
      parts.push(`<attachments>\n以下是父 Agent 传递的附件文件，供你参考使用：\n\n${attachmentLines}\n</attachments>`);
    }

    const constraints = [
      '- 专注完成分配的任务，不要偏离',
      '- 完成后简洁地返回结果',
      '- 不要搜索记忆库，所需信息已在任务描述和上下文中提供',
    ];

    if (role === 'leaf') {
      constraints.push('- 你是 leaf 子 Agent，不能再创建新的子 Agent');
    } else if (role === 'orchestrator') {
      constraints.push('- 你是 orchestrator 子 Agent，可以创建子 Agent 来并行处理子任务');
      constraints.push('- 创建子 Agent 后使用 yield_agents 等待结果，不要轮询');
    }

    parts.push(`<constraints>\n${constraints.join('\n')}\n</constraints>`);

    return parts.join('\n\n');
  }
}
