/**
 * 子 Agent 生命周期管理器
 * 追踪子 Agent 状态、支持 spawn/list/kill/steer 操作
 * 参考 OpenClaw subagent-spawn.ts 架构设计
 */

import crypto from 'node:crypto';
import { runEmbeddedAgent } from './embedded-runner.js';
import type { AgentRunConfig, RuntimeEvent } from './types.js';
import type { LaneQueue } from './lane-queue.js';
import { DEFAULT_MAX_SPAWN_DEPTH, type AgentConfig, type ChatMessage } from '@evoclaw/shared';
import { SAFETY_CONSTITUTION } from './embedded-runner-prompt.js';
import type { PermissionBubbleManager, PermissionEmitFn } from './permission-bubble.js';

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

/** @deprecated 使用 DEFAULT_MAX_SPAWN_DEPTH（从 @evoclaw/shared 导入） */
export const MAX_SPAWN_DEPTH = DEFAULT_MAX_SPAWN_DEPTH;

/** 每 Agent 最大同时活跃子代数 */
export const MAX_CHILDREN_PER_AGENT = 5;

/** 子 Agent 默认超时（300 秒） */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 300_000;

/** 子 Agent 结果不可信标记（防提示注入） */
const UNTRUSTED_BEGIN = '<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>';
const UNTRUSTED_END = '<<<END_UNTRUSTED_CHILD_RESULT>>>';

/** Fork 子 Agent 标记（用于递归防护检测） */
const FORK_BOILERPLATE_TAG = '<fork-boilerplate>';

/** Fork 子 Agent 结构化输出模板 */
const FORK_DIRECTIVE_TEMPLATE = `${FORK_BOILERPLATE_TAG}
你是一个 Fork Worker 进程，不是主 Agent。
规则：
1. 不要创建子 Agent，直接使用工具执行
2. 不要闲聊或提问
3. 直接使用你的工具：read, write, edit, bash, grep 等
4. 保持报告简洁（不超过 500 字）
5. 响应必须以 "Scope:" 开头

输出格式：
  Scope: <回显任务范围>
  Result: <发现/成果>
  Key files: <涉及的关键文件路径>
  Changes: <修改的文件列表（如有）>
  Issues: <发现的问题（如有）>
</fork-boilerplate>`;

/**
 * 构建 Cache-Safe 的 Fork 消息
 *
 * 策略: 使用 parent 的最后 N 条消息 + fork 指令消息
 * 确保系统提示词完全一致 → prompt cache 命中
 *
 * @param parentMessages - 父 Agent 当前消息历史
 * @param directive - fork 任务指令
 * @returns 构建好的消息列表
 */
export function buildCacheSafeForkedMessages(
  parentMessages: ReadonlyArray<ChatMessage>,
  directive: string,
): ChatMessage[] {
  // 取最后 10 条消息（避免 token 爆炸，同时保持足够上下文）
  const recentMessages = parentMessages.slice(-10);

  // 追加 fork 指令作为用户消息
  const forkUserMessage: ChatMessage = {
    id: crypto.randomUUID(),
    conversationId: recentMessages[0]?.conversationId ?? '',
    role: 'user',
    content: `${FORK_DIRECTIVE_TEMPLATE}\n<fork-directive>${directive}</fork-directive>`,
    createdAt: new Date().toISOString(),
  };

  return [...recentMessages, forkUserMessage];
}

/**
 * 检测消息历史中是否已有 fork 标记（递归 fork 防护）
 */
export function isInForkChild(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  return messages.some(
    m => m.role === 'user' && m.content.includes(FORK_BOILERPLATE_TAG),
  );
}

/** 所有子代理始终禁止的工具（安全降权 + 防泄露） */
const DENIED_TOOLS_FOR_ALL_CHILDREN = new Set([
  'memory_search',    // 记忆访问（防泄露）— 信息应在 spawn prompt 中传递
  'memory_get',       // 记忆访问
  'knowledge_query',  // 知识图谱
  'desktop_notify',   // 用户通知 — 子代理不应直接通知用户
  // 通道工具 — 子代理不应直接发送消息
  'feishu_send', 'feishu_card', 'wecom_send', 'weixin_send', 'weixin_send_media',
]);

/** 叶子节点子代理额外禁止的工具（不能再生成/管理子代） */
const DENIED_TOOLS_FOR_LEAF = new Set([
  'spawn_agent',   // 只有 orchestrator 可以派生
  'list_agents',   // 不需要查询
  'kill_agent',    // 不需要终止
  'steer_agent',   // 不需要纠偏
  'yield_agents',  // 不需要等待
]);

/** 子 Agent Spawn 模式 */
export type SpawnMode = 'run' | 'session';

/** 子 Agent 状态 */
export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'idle';

/** 子 Agent 角色（参考 OpenClaw 三层角色） */
export type SubAgentRole = 'main' | 'orchestrator' | 'leaf';

/** 工具活动记录（进度追踪） */
export interface ToolActivity {
  toolName: string;
  timestamp: number;
}

/** 子 Agent 进度追踪（参考 Claude Code ProgressTracker） */
export interface SubAgentProgress {
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
  /** 最近 5 个工具活动 */
  recentActivities: ToolActivity[];
}

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
  /** 子代的 spawner 引用（用于级联 kill） */
  childSpawner?: SubAgentSpawner;
  /** Spawn 模式 */
  mode: SpawnMode;
  /** 子 Agent 类型 */
  agentType?: string;
  /** 进度追踪 */
  progress: SubAgentProgress;
  /** 是否 Fork 模式（继承父 prompt 缓存） */
  isFork?: boolean;
  /** 上次执行的消息快照（abort 后保留，供 steer 重执行使用） */
  lastMessagesSnapshot?: import('./types.js').MessageSnapshot[];
}

/** 结构化完成通知 */
export interface SubAgentNotification {
  taskId: string;
  task: string;
  agentType?: string;
  status: 'completed' | 'failed' | 'cancelled';
  success: boolean;
  result: string;
  durationMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
}

/** 完成通知回调 */
export type OnSubAgentComplete = (
  taskId: string, task: string, result: string, success: boolean,
  notification?: SubAgentNotification,
) => void;

/** 根据深度确定角色 */
function resolveRole(depth: number, maxDepth: number): SubAgentRole {
  if (depth === 0) return 'main';
  if (depth < maxDepth) return 'orchestrator';
  return 'leaf';
}

/**
 * 子 Agent 生命周期管理器
 */
export class SubAgentSpawner {
  private agents = new Map<string, SubAgentEntry>();
  /** 待推送的子代完成通知 */
  private pendingAnnouncements: SubAgentNotification[] = [];
  /** 可配置最大嵌套深度 */
  readonly maxSpawnDepth: number;

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
    /** 最大嵌套深度（默认 DEFAULT_MAX_SPAWN_DEPTH） */
    maxSpawnDepth?: number,
    /** 获取父 Agent 当前消息历史（用于 Fork Cache-Safe） */
    private getParentMessages?: () => ReadonlyArray<import('@evoclaw/shared').ChatMessage>,
    /** 权限拦截函数 — 子 Agent 工具调用前检查（不传则子 Agent 绕过权限系统） */
    private permissionInterceptFn?: AgentRunConfig['permissionInterceptFn'],
    /** 权限冒泡管理器 — 子 Agent 工具需要用户授权时暂停等待（不传则阻断模式） */
    private permissionBubbleManager?: PermissionBubbleManager,
    /** 权限冒泡 SSE 事件发射回调 */
    private onPermissionEmit?: PermissionEmitFn,
  ) {
    this.maxSpawnDepth = maxSpawnDepth ?? DEFAULT_MAX_SPAWN_DEPTH;
  }

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
    /** Spawn 模式（默认 'run'） */
    mode?: SpawnMode;
    /** 子 Agent 类型（预定义: general/researcher/writer/analyst） */
    agentType?: string;
    /** Fork 模式：继承父 Agent 的完整 system prompt（复用缓存） */
    fork?: boolean;
  }): string {
    if (this.currentDepth >= this.maxSpawnDepth) {
      throw new Error(`已达最大嵌套深度（${this.maxSpawnDepth} 层），无法继续创建子 Agent`);
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

    const spawnMode = options?.mode ?? 'run';

    // 注册到活跃列表
    const entry: SubAgentEntry = {
      taskId,
      task,
      status: 'running',
      startedAt: Date.now(),
      abortController,
      announced: false,
      mode: spawnMode,
      agentType: options?.agentType,
      progress: { toolUseCount: 0, inputTokens: 0, outputTokens: 0, recentActivities: [] },
      isFork: options?.fork === true,
    };
    this.agents.set(taskId, entry);

    // 确定子 Agent 角色
    const childDepth = this.currentDepth + 1;
    const childRole = resolveRole(childDepth, this.maxSpawnDepth);

    // 工具降权：过滤掉子 Agent 不应获得的工具
    const filteredTools = (this.parentConfig.tools ?? []).filter(tool => {
      if (DENIED_TOOLS_FOR_ALL_CHILDREN.has(tool.name)) return false;
      if (childRole === 'leaf' && DENIED_TOOLS_FOR_LEAF.has(tool.name)) return false;
      return true;
    });

    // 构建子 Agent 配置
    // Fork 模式: 继承父 Agent 完整 system prompt（复用 prompt cache）
    // 类型模式: 使用预定义类型的 system prompt
    // 默认: 构建最小 prompt
    let systemPrompt: string;
    let effectiveTools = filteredTools;

    if (entry.isFork) {
      // Fork: 继承父 prompt（缓存命中最大化）
      systemPrompt = this.parentConfig.systemPrompt;

      // 递归 fork 防护：检测是否已在 fork child 中
      const parentMsgs = this.getParentMessages?.() ?? [];
      if (isInForkChild(parentMsgs)) {
        throw new Error('已在 Fork 子 Agent 中，禁止递归 Fork');
      }
    } else if (entry.agentType) {
      // 预定义类型
      let typeDef: any = null;
      try {
        const { getSubAgentType } = require('./agent-types.js') as typeof import('./agent-types.js');
        typeDef = getSubAgentType(entry.agentType);
      } catch { /* agent-types 不可用时降级为 general */ }

      if (typeDef) {
        // 加载该类型的持久记忆（如果有）
        let typeMemory: string | null = null;
        try {
          const { readAgentMemory } = require('./agent-memory.js') as typeof import('./agent-memory.js');
          typeMemory = readAgentMemory(entry.agentType!);
        } catch { /* agent-memory 不可用时跳过 */ }
        const memorySection = typeMemory ? `\n\n<agent_memory>\n${typeMemory}\n</agent_memory>` : '';

        // 共享安全宪法前缀 → 利用 Anthropic 前缀匹配 cache
        // parent system prompt 以 SAFETY_CONSTITUTION 开头，type sub-agent 也以它开头
        // → 前缀字节一致 → prompt cache 命中率从 0% 提升到 60-70%
        systemPrompt = SAFETY_CONSTITUTION + '\n\n---\n\n' + typeDef.systemPrompt + memorySection + '\n\n' + this.buildMinimalPrompt(task, context, childRole, options?.attachments);
        // 工具白名单过滤
        if (typeDef.allowedTools) {
          const allowed = new Set(typeDef.allowedTools);
          effectiveTools = filteredTools.filter(t => allowed.has(t.name));
        }
      } else {
        systemPrompt = this.buildMinimalPrompt(task, context, childRole, options?.attachments);
      }
    } else {
      systemPrompt = this.buildMinimalPrompt(task, context, childRole, options?.attachments);
    }

    // Fork Cache-Safe: 传递父消息给 fork child（系统提示一致 → prompt cache 命中）
    let childMessages: ChatMessage[] = [];
    if (entry.isFork && this.getParentMessages) {
      const parentMsgs = this.getParentMessages();
      childMessages = buildCacheSafeForkedMessages(parentMsgs, task);
    }

    // 按角色精简工作区文件注入（减少 leaf 每次调用 1-3K tokens）
    // Type sub-agent（有 agentType）的工作区文件只需 TOOLS.md
    const childWorkspaceFiles = entry.agentType
      ? (targetWorkspaceFiles['TOOLS.md'] ? { 'TOOLS.md': targetWorkspaceFiles['TOOLS.md'] } : {})
      : this.getWorkspaceFilesForRole(childRole, targetWorkspaceFiles);

    // 权限拦截：冒泡模式（有 bubbleManager）或阻断模式（直接拒绝）
    const childPermissionFn = this.permissionBubbleManager && this.onPermissionEmit && this.permissionInterceptFn
      ? this.permissionBubbleManager.createSubAgentInterceptFn(
          this.permissionInterceptFn, taskId, this.onPermissionEmit,
        )
      : this.permissionInterceptFn;

    const childConfig: AgentRunConfig = {
      agent: targetAgent,
      systemPrompt,
      workspaceFiles: childWorkspaceFiles,
      modelId: this.parentConfig.modelId,
      provider: this.parentConfig.provider,
      apiKey: this.parentConfig.apiKey,
      baseUrl: this.parentConfig.baseUrl,
      apiProtocol: this.parentConfig.apiProtocol,
      tools: effectiveTools,
      messages: childMessages,
      mcpManager: this.parentConfig.mcpManager,
      permissionInterceptFn: childPermissionFn,
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
          const agentResult = await runEmbeddedAgent(
            childConfig,
            task,
            (event: RuntimeEvent) => {
              if (event.type === 'text_delta' && event.delta) {
                result += event.delta;
              }
              // 进度追踪
              if (event.type === 'tool_start' && event.toolName) {
                entry.progress.toolUseCount++;
                entry.progress.recentActivities.push({ toolName: event.toolName, timestamp: Date.now() });
                if (entry.progress.recentActivities.length > 5) entry.progress.recentActivities.shift();
              }
              // Token 用量追踪
              if (event.type === 'usage' && event.usage) {
                entry.progress.inputTokens += event.usage.inputTokens ?? 0;
                entry.progress.outputTokens += event.usage.outputTokens ?? 0;
              }
            },
            abortController.signal,
          );

          // 保存消息快照（供 steer 重执行时传入历史上下文）
          entry.lastMessagesSnapshot = agentResult?.messagesSnapshot;

          // 包裹不可信标记（防提示注入）
          const rawResult = result || '（子 Agent 未返回内容）';
          entry.result = `${UNTRUSTED_BEGIN}\n${rawResult}\n${UNTRUSTED_END}`;
          entry.completedAt = Date.now();
          // session 模式：完成后进入 idle 而非 completed
          entry.status = spawnMode === 'session' ? 'idle' : 'completed';

          // Push-based 通知：结构化结果入队
          const notification: SubAgentNotification = {
            taskId, task,
            agentType: entry.agentType,
            status: 'completed',
            success: true,
            result: entry.result,
            durationMs: entry.completedAt - entry.startedAt,
            tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
          };
          this.pendingAnnouncements.push(notification);
          this.onComplete?.(taskId, task, entry.result, true, notification);
        } catch (err) {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.completedAt = Date.now();

          // Push-based 通知：错误入队
          const notification: SubAgentNotification = {
            taskId, task,
            agentType: entry.agentType,
            status: 'failed',
            success: false,
            result: entry.error ?? '',
            durationMs: entry.completedAt - entry.startedAt,
            tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
          };
          this.pendingAnnouncements.push(notification);
          this.onComplete?.(taskId, task, entry.error ?? '', false, notification);
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

  /** 终止子 Agent（级联：递归终止所有后代） */
  kill(taskId: string): boolean {
    const entry = this.agents.get(taskId);
    if (!entry) return false;

    if (entry.status === 'running' || entry.status === 'idle') {
      // 先递归 kill 所有孙代
      if (entry.childSpawner) {
        entry.childSpawner.killAll();
      }
      entry.abortController.abort();
      entry.status = 'cancelled';
      entry.completedAt = Date.now();
      return true;
    }
    return false;
  }

  /** 终止所有运行中/idle 的子 Agent（级联） */
  killAll(): void {
    for (const entry of this.agents.values()) {
      if (entry.status === 'running' || entry.status === 'idle') {
        this.kill(entry.taskId);
      }
    }
  }

  /** 获取单个子 Agent 状态 */
  get(taskId: string): SubAgentEntry | undefined {
    return this.agents.get(taskId);
  }

  /**
   * 纠偏子 Agent（steer）
   * - session 模式且 idle：调用 resume(taskId, correction)
   * - run/session 模式且 running：中止当前执行 → 复用原条目重新启动（保留 Task ID）
   */
  steer(taskId: string, correction: string): string {
    const entry = this.agents.get(taskId);
    if (!entry) {
      throw new Error(`未找到 Task ID 为 ${taskId} 的子 Agent`);
    }

    // session 模式且 idle：使用 resume
    if (entry.mode === 'session' && entry.status === 'idle') {
      this.resume(taskId, correction);
      return taskId;
    }

    if (entry.status !== 'running') {
      throw new Error(`子 Agent ${taskId} 当前状态为 "${entry.status}"，仅运行中的子 Agent 可以纠偏`);
    }

    // In-place steer：中止当前执行 → 复用原条目重新启动
    entry.abortController.abort();
    entry.abortController = new AbortController();
    entry.status = 'running';
    entry.completedAt = undefined;
    entry.announced = false;
    entry.result = undefined;
    entry.error = undefined;
    entry.progress = { toolUseCount: 0, inputTokens: 0, outputTokens: 0, recentActivities: [] };

    const steeredTask = `${entry.task}\n\n[纠偏指令] ${correction}`;
    entry.task = steeredTask;

    // 权限拦截：冒泡模式或阻断模式
    const steerPermissionFn = this.permissionBubbleManager && this.onPermissionEmit && this.permissionInterceptFn
      ? this.permissionBubbleManager.createSubAgentInterceptFn(
          this.permissionInterceptFn, taskId, this.onPermissionEmit,
        )
      : this.permissionInterceptFn;

    // 重新入队执行
    const sessionKey = `agent:${this.parentConfig.agent.id}:local:subagent:${taskId}`;
    const spawnMode = entry.mode;
    const abortController = entry.abortController;

    this.laneQueue.enqueue({
      id: `${taskId}-steer-${Date.now()}`,
      sessionKey,
      lane: 'subagent',
      task: async () => {
        // 恢复上次执行的消息历史（LaneQueue sessionKey 串行保证此时 lastMessagesSnapshot 已被旧任务填充）
        const previousMessages = entry.lastMessagesSnapshot
          ?.map(m => ({ role: m.role, content: m.content, isSummary: m.isSummary })) ?? [];

        let result = '';
        try {
          const agentResult = await runEmbeddedAgent(
            {
              ...this.parentConfig,
              messages: previousMessages as import('@evoclaw/shared').ChatMessage[],
              systemPrompt: this.buildMinimalPrompt(steeredTask),
              permissionInterceptFn: steerPermissionFn,
            },
            steeredTask,
            (event: RuntimeEvent) => {
              if (event.type === 'text_delta' && event.delta) {
                result += event.delta;
              }
              if (event.type === 'tool_start' && event.toolName) {
                entry.progress.toolUseCount++;
                entry.progress.recentActivities.push({ toolName: event.toolName, timestamp: Date.now() });
                if (entry.progress.recentActivities.length > 5) entry.progress.recentActivities.shift();
              }
              if (event.type === 'usage' && event.usage) {
                entry.progress.inputTokens += event.usage.inputTokens ?? 0;
                entry.progress.outputTokens += event.usage.outputTokens ?? 0;
              }
            },
            abortController.signal,
          );

          // 保存消息快照（供后续 steer 使用）
          entry.lastMessagesSnapshot = agentResult?.messagesSnapshot;

          const rawResult = result || '（子 Agent 未返回内容）';
          entry.result = `${UNTRUSTED_BEGIN}\n${rawResult}\n${UNTRUSTED_END}`;
          entry.completedAt = Date.now();
          entry.status = spawnMode === 'session' ? 'idle' : 'completed';

          const notification: SubAgentNotification = {
            taskId, task: steeredTask,
            agentType: entry.agentType,
            status: 'completed',
            success: true,
            result: entry.result,
            durationMs: entry.completedAt - entry.startedAt,
            tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
          };
          this.pendingAnnouncements.push(notification);
          this.onComplete?.(taskId, steeredTask, entry.result, true, notification);
        } catch (err) {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.completedAt = Date.now();

          const notification: SubAgentNotification = {
            taskId, task: steeredTask,
            agentType: entry.agentType,
            status: 'failed',
            success: false,
            result: entry.error ?? '',
            durationMs: entry.completedAt - entry.startedAt,
            tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
          };
          this.pendingAnnouncements.push(notification);
          this.onComplete?.(taskId, steeredTask, entry.error ?? '', false, notification);
        }
      },
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    }).catch(() => {
      if (entry.status === 'running') {
        entry.status = 'failed';
        entry.error = `子 Agent steer 执行超时`;
        entry.completedAt = Date.now();
      }
    });

    return taskId;
  }

  /**
   * Resume 一个 idle 状态的 session 模式子 Agent
   */
  resume(taskId: string, followUp: string): void {
    const entry = this.agents.get(taskId);
    if (!entry) {
      throw new Error(`未找到 Task ID 为 ${taskId} 的子 Agent`);
    }
    if (entry.mode !== 'session') {
      throw new Error(`子 Agent ${taskId} 不是 session 模式，无法 resume`);
    }
    if (entry.status !== 'idle') {
      throw new Error(`子 Agent ${taskId} 当前状态为 "${entry.status}"，仅 idle 状态可以 resume`);
    }

    // 重新激活
    entry.status = 'running';
    entry.completedAt = undefined;
    entry.abortController = new AbortController();
    entry.announced = false;

    const sessionKey = `agent:${this.parentConfig.agent.id}:local:subagent:${taskId}`;
    const resumeTask = `${entry.task}\n\n[后续指令] ${followUp}`;

    // 权限拦截：冒泡模式或阻断模式
    const resumePermissionFn = this.permissionBubbleManager && this.onPermissionEmit && this.permissionInterceptFn
      ? this.permissionBubbleManager.createSubAgentInterceptFn(
          this.permissionInterceptFn, taskId, this.onPermissionEmit,
        )
      : this.permissionInterceptFn;

    this.laneQueue.enqueue({
      id: `${taskId}-resume-${Date.now()}`,
      sessionKey,
      lane: 'subagent',
      task: async () => {
        let result = '';
        try {
          const agentResult = await runEmbeddedAgent(
            {
              ...this.parentConfig,
              messages: [],
              systemPrompt: this.buildMinimalPrompt(resumeTask),
              permissionInterceptFn: resumePermissionFn,
            },
            resumeTask,
            (event: RuntimeEvent) => {
              if (event.type === 'text_delta' && event.delta) {
                result += event.delta;
              }
              // Token 用量追踪
              if (event.type === 'usage' && event.usage) {
                entry.progress.inputTokens += event.usage.inputTokens ?? 0;
                entry.progress.outputTokens += event.usage.outputTokens ?? 0;
              }
            },
            entry.abortController.signal,
          );
          // 保存消息快照
          entry.lastMessagesSnapshot = agentResult?.messagesSnapshot;

          const rawResult = result || '（子 Agent 未返回内容）';
          entry.result = `${UNTRUSTED_BEGIN}\n${rawResult}\n${UNTRUSTED_END}`;
          entry.completedAt = Date.now();
          entry.status = 'idle';

          const notification: SubAgentNotification = {
            taskId, task: resumeTask,
            agentType: entry.agentType,
            status: 'completed',
            success: true,
            result: entry.result,
            durationMs: entry.completedAt - entry.startedAt,
            tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
          };
          this.pendingAnnouncements.push(notification);
          this.onComplete?.(taskId, resumeTask, entry.result, true, notification);
        } catch (err) {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
          entry.completedAt = Date.now();

          const notification: SubAgentNotification = {
            taskId, task: resumeTask,
            agentType: entry.agentType,
            status: 'failed',
            success: false,
            result: entry.error ?? '',
            durationMs: entry.completedAt - entry.startedAt,
            tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
          };
          this.pendingAnnouncements.push(notification);
          this.onComplete?.(taskId, resumeTask, entry.error ?? '', false, notification);
        }
      },
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
    }).catch(() => {
      if (entry.status === 'running') {
        entry.status = 'failed';
        entry.error = `子 Agent resume 执行超时`;
        entry.completedAt = Date.now();
      }
    });
  }

  /**
   * 获取未通知的已完成结果（auto-announce 模式）
   * 返回后标记为已通知，释放 result 引用以节省内存
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
        entry.result = undefined;  // 结果已复制到返回数组，释放原始引用
      } else if (entry.status === 'failed') {
        results.push({
          taskId: entry.taskId,
          task: entry.task,
          result: entry.error ?? '未知错误',
          success: false,
        });
        entry.announced = true;
        entry.error = undefined;  // 释放错误引用
      }
    }

    return results;
  }

  /**
   * 排空结构化通知（推荐使用）
   * 返回完整的结构化通知数组
   */
  drainStructuredAnnouncements(): SubAgentNotification[] {
    const notifications = [...this.pendingAnnouncements];
    this.pendingAnnouncements = [];
    return notifications;
  }

  /**
   * 排空待推送通知（Push-based 通知机制）
   * 返回格式化的通知文本，或 null 如果没有待推送通知
   */
  drainAnnouncements(): string | null {
    const notifications = this.drainStructuredAnnouncements();
    if (notifications.length === 0) return null;
    return notifications.map(n =>
      `[子 Agent 完成] Task: ${n.taskId}\n类型: ${n.agentType ?? 'general'}\n状态: ${n.success ? '成功' : '失败'}\n耗时: ${(n.durationMs / 1000).toFixed(1)}s\nTokens: ${n.tokenUsage.inputTokens}/${n.tokenUsage.outputTokens}\n结果:\n${n.result}`
    ).join('\n\n---\n\n');
  }

  /**
   * 清理超时的 idle session 模式子代
   * @param maxIdleMs 最大 idle 时间（默认 30 分钟）
   */
  cleanupIdleSessions(maxIdleMs: number = 30 * 60 * 1000): number {
    let cleaned = 0;
    const now = Date.now();
    for (const entry of this.agents.values()) {
      if (entry.mode === 'session' && entry.status === 'idle' && entry.completedAt) {
        if (now - entry.completedAt >= maxIdleMs) {
          entry.status = 'cancelled';
          entry.completedAt = now;
          cleaned++;
        }
      }
    }
    return cleaned;
  }

  /**
   * 清除已完成/失败/取消且已通知的条目，释放内存
   * @param retainMs 保留时间（默认 5 分钟，确保 list_agents 有时间读取）
   * @returns 清除数量
   */
  evictCompleted(retainMs: number = 5 * 60 * 1000): number {
    let evicted = 0;
    const now = Date.now();
    for (const [taskId, entry] of this.agents) {
      const isTerminal = entry.status === 'completed' || entry.status === 'failed' || entry.status === 'cancelled';
      if (!isTerminal) continue;
      if (!entry.announced) continue;
      if (entry.completedAt && now - entry.completedAt < retainMs) continue;

      // 递归清理子代 spawner
      entry.childSpawner?.dispose();
      this.agents.delete(taskId);
      evicted++;
    }
    return evicted;
  }

  /**
   * 统一清理：idle 超时 + 已完成条目驱逐
   * 建议在 SSE progress 轮询定时器中每 30s 调用
   */
  cleanup(options?: { maxIdleMs?: number; retainMs?: number }): { idleCleaned: number; evicted: number } {
    const idleCleaned = this.cleanupIdleSessions(options?.maxIdleMs);
    const evicted = this.evictCompleted(options?.retainMs);
    return { idleCleaned, evicted };
  }

  /**
   * 销毁 spawner：终止所有运行中子 Agent，清理全部条目
   * 在父 Agent 会话结束时调用
   */
  dispose(): void {
    this.killAll();
    for (const entry of this.agents.values()) {
      entry.childSpawner?.dispose();
      entry.result = undefined;
      entry.error = undefined;
    }
    this.agents.clear();
    this.pendingAnnouncements = [];
  }

  /** 是否有子 Agent 正在运行 */
  get hasRunning(): boolean {
    for (const entry of this.agents.values()) {
      if (entry.status === 'running') return true;
    }
    return false;
  }

  /**
   * 获取所有活跃（running）或刚完成的子 Agent 条目快照
   * 用于 SSE 进度推送 — 返回后不修改原始条目
   */
  getProgressSnapshot(): Array<{
    taskId: string;
    agentType?: string;
    task: string;
    status: SubAgentStatus;
    progress: SubAgentProgress;
    startedAt: number;
    completedAt?: number;
  }> {
    const entries: Array<{
      taskId: string;
      agentType?: string;
      task: string;
      status: SubAgentStatus;
      progress: SubAgentProgress;
      startedAt: number;
      completedAt?: number;
    }> = [];

    for (const entry of this.agents.values()) {
      // 只包含 running 或最近 10s 内完成的（让前端有时间收到完成状态）
      if (entry.status === 'running' ||
          (entry.completedAt && Date.now() - entry.completedAt < 10_000)) {
        entries.push({
          taskId: entry.taskId,
          agentType: entry.agentType,
          task: entry.task,
          status: entry.status,
          progress: { ...entry.progress, recentActivities: [...entry.progress.recentActivities] },
          startedAt: entry.startedAt,
          completedAt: entry.completedAt,
        });
      }
    }

    return entries;
  }

  /**
   * 按角色精简工作区文件注入
   * - orchestrator: 需要 AGENTS.md（了解可用子 Agent）+ TOOLS.md + SOUL.md
   * - type (researcher/writer/analyst): 只需 TOOLS.md（工具列表）
   * - leaf: 最小化，不注入任何工作区文件（任务描述已足够）
   */
  private getWorkspaceFilesForRole(
    role: SubAgentRole,
    source: Record<string, string>,
  ): Record<string, string> {
    const files: Record<string, string> = {};

    switch (role) {
      case 'orchestrator': {
        // Orchestrator 需要全貌来分解任务
        const keys = ['AGENTS.md', 'TOOLS.md', 'SOUL.md'];
        for (const key of keys) {
          if (source[key]) files[key] = source[key];
        }
        break;
      }
      case 'main': {
        // main 角色（不应出现在子 Agent 中，但兜底处理）
        const keys = ['AGENTS.md', 'TOOLS.md'];
        for (const key of keys) {
          if (source[key]) files[key] = source[key];
        }
        break;
      }
      case 'leaf':
        // Leaf 最小化 — 任务描述中已有足够上下文
        break;
    }

    return files;
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
      // Anti-lazy-delegation 规则
      constraints.push('- 收到子 Agent 返回的结果后，你必须阅读并理解内容，基于你的理解生成输出');
      constraints.push('- 禁止直接将子 Agent 的结果原样转发，禁止使用"根据子 Agent 的结果..."这类惰性表述');
    }

    parts.push(`<constraints>\n${constraints.join('\n')}\n</constraints>`);

    return parts.join('\n\n');
  }
}
