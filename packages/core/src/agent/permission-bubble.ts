/**
 * 子 Agent 权限冒泡管理器
 *
 * 当子 Agent 工具调用需要用户授权时：
 * 1. 创建 pending Promise + 生成 requestId
 * 2. 通过 onEmit 回调推送 permission_required SSE 事件到前端
 * 3. 前端弹窗 → 用户决策 → POST /security/:agentId/permission-decision
 * 4. resolve Promise → 子 Agent 工具继续/拒绝
 *
 * 超时保护：120s 无响应自动拒绝，防止 LaneQueue slot 永久占用
 */

import crypto from 'node:crypto';
import type { AgentRunConfig } from './types.js';

/** 权限冒泡请求 */
export interface PermissionBubbleRequest {
  requestId: string;
  /** 来源子 Agent 的 taskId */
  subagentTaskId: string;
  toolName: string;
  category: string;
  resource: string;
  reason?: string;
}

/** 权限决策结果 */
export type PermissionDecision = 'allow' | 'deny';

/** 待决权限请求内部状态 */
interface PendingRequest {
  request: PermissionBubbleRequest;
  resolve: (decision: PermissionDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

/** SSE 事件发射回调 */
export type PermissionEmitFn = (request: PermissionBubbleRequest) => void;

/**
 * 全局权限决策注册表 — 跨路由解析待决权限请求
 * 多个 SSE 连接各自创建 PermissionBubbleManager，但决策 API 通过 requestId 路由到正确的 manager
 */
const globalPendingResolvers = new Map<string, (decision: PermissionDecision) => void>();

/**
 * 从外部（API 端点）解析待决权限请求
 * @returns true 如果找到并处理了该请求
 */
export function resolvePermissionDecision(requestId: string, decision: PermissionDecision): boolean {
  const resolver = globalPendingResolvers.get(requestId);
  if (!resolver) return false;
  globalPendingResolvers.delete(requestId);
  resolver(decision);
  return true;
}

/** 获取全局待决请求数量（调试用） */
export function getGlobalPendingCount(): number {
  return globalPendingResolvers.size;
}

/**
 * 权限冒泡管理器 — 管理子 Agent 待决权限请求的生命周期
 */
export class PermissionBubbleManager {
  private pending = new Map<string, PendingRequest>();

  constructor(
    /** 权限请求超时（默认 120s） */
    private timeoutMs: number = 120_000,
  ) {}

  /**
   * 创建子 Agent 专用的 permissionInterceptFn
   * 包装父 Agent 的原始 interceptFn，在需要用户确认时通过 SSE 冒泡到前端等待
   */
  createSubAgentInterceptFn(
    parentInterceptFn: AgentRunConfig['permissionInterceptFn'],
    subagentTaskId: string,
    onEmit: PermissionEmitFn,
  ): NonNullable<AgentRunConfig['permissionInterceptFn']> {
    return async (toolName: string, args: Record<string, unknown>): Promise<string | null> => {
      if (!parentInterceptFn) return null; // 无父拦截器 → 全部允许

      // 先调用父 Agent 的权限拦截器
      const rejection = await parentInterceptFn(toolName, args);

      if (rejection === null) return null; // 允许

      // 检查是否是需要用户确认的拒绝（包含"权限"关键词）
      // 父 interceptFn 返回拒绝字符串 → 创建冒泡请求等待用户决策
      const category = this.extractCategory(rejection);
      const resource = (args['path'] as string) ?? (args['file_path'] as string) ?? (args['command'] as string) ?? '*';

      const request: PermissionBubbleRequest = {
        requestId: crypto.randomUUID(),
        subagentTaskId,
        toolName,
        category,
        resource,
        reason: rejection,
      };

      // 推送 SSE 事件到前端
      onEmit(request);

      // 等待用户决策（或超时）
      const decision = await this.waitForDecision(request);

      if (decision === 'allow') {
        return null; // 允许继续
      }
      return rejection; // 拒绝 — 返回原始拒绝字符串
    };
  }

  /**
   * 等待用户权限决策
   * @returns Promise 在用户决策或超时后 resolve
   */
  private waitForDecision(request: PermissionBubbleRequest): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      const wrappedResolve = (decision: PermissionDecision) => {
        clearTimeout(timer);
        this.pending.delete(request.requestId);
        globalPendingResolvers.delete(request.requestId);
        resolve(decision);
      };

      const timer = setTimeout(() => {
        wrappedResolve('deny'); // 超时自动拒绝
      }, this.timeoutMs);

      this.pending.set(request.requestId, {
        request,
        resolve: wrappedResolve,
        timer,
        createdAt: Date.now(),
      });

      // 注册到全局解析表，允许 API 端点通过 requestId 解析
      globalPendingResolvers.set(request.requestId, wrappedResolve);
    });
  }

  /** 获取所有待决请求（用于调试/状态查询） */
  getPendingRequests(): PermissionBubbleRequest[] {
    return [...this.pending.values()].map(e => e.request);
  }

  /** 待决请求数量 */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** 清理所有待决请求（全部拒绝） */
  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      globalPendingResolvers.delete(entry.request.requestId);
      entry.resolve('deny');
    }
    this.pending.clear();
  }

  /** 从拒绝字符串中提取权限类别 */
  private extractCategory(rejection: string): string {
    // 匹配 "需要「shell」权限" 或 "需要「network」权限" 格式
    const match = rejection.match(/[「"'](\w+)[」"']/);
    return match?.[1] ?? 'unknown';
  }
}
