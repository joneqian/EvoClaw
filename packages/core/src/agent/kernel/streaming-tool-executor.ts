/**
 * 流中工具预执行器 — 参考 Claude Code StreamingToolExecutor
 *
 * 核心设计:
 * - 流式输出过程中就开始执行并发安全工具 (不等流结束)
 * - 并发安全工具并行执行，非安全工具串行
 * - 基于信号量的并发控制
 * - discard() 支持流式回退时清理孤立执行
 *
 * 参考 Claude Code:
 * - services/tools/StreamingToolExecutor.ts
 * - addTool() 入队 → processQueue() 并发执行 → getRemainingResults() 收集
 *
 * 参考文档: docs/research/08-tool-system.md
 */

import type { KernelTool, ToolCallResult, ToolUseBlock, ToolResultBlock } from './types.js';
import type { RuntimeEvent } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type ToolStatus = 'queued' | 'executing' | 'completed';

interface TrackedTool {
  block: ToolUseBlock;
  status: ToolStatus;
  isConcurrencySafe: boolean;
  promise?: Promise<ToolCallResult>;
  result?: ToolCallResult;
}

interface CollectConfig {
  onEvent: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════════════════
// StreamingToolExecutor
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 流中工具预执行器
 *
 * 使用方式:
 * 1. 流式接收 tool_use blocks 时调用 enqueue()
 * 2. 并发安全工具立即开始执行
 * 3. 流结束后调用 collectResults() 获取所有结果
 *    - 已预执行的直接返回
 *    - 未预执行的 (串行工具) 按顺序执行
 *
 * 参考 Claude Code:
 * - addTool() → processQueue() → getRemainingResults()
 * - Bash 工具错误取消兄弟工具 (sibling abort)
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = [];
  private toolMap: Map<string, KernelTool>;
  private maxConcurrency: number;
  private activeConcurrent = 0;
  private discarded = false;

  constructor(tools: readonly KernelTool[], maxConcurrency = 8) {
    this.toolMap = new Map(tools.map(t => [t.name, t]));
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 入队一个 tool_use block
   *
   * 如果是并发安全工具且有并发余量 → 立即开始执行
   * 否则 → 等待 collectResults() 时串行执行
   */
  enqueue(block: ToolUseBlock): void {
    if (this.discarded) return;

    const tool = this.toolMap.get(block.name);
    const isConcurrencySafe = tool?.isConcurrencySafe() ?? false;

    const tracked: TrackedTool = {
      block,
      status: 'queued',
      isConcurrencySafe,
    };
    this.tools.push(tracked);

    // 并发安全 + 有余量 → 立即预执行
    if (isConcurrencySafe && this.activeConcurrent < this.maxConcurrency) {
      this.startExecution(tracked);
    }
  }

  /**
   * 收集所有工具结果
   *
   * 按入队顺序返回:
   * - 已预执行的: await promise
   * - 未执行的: 按顺序执行 (串行工具)
   *
   * 每个结果完成后 emit tool_end 事件
   */
  async collectResults(config: CollectConfig): Promise<ToolResultBlock[]> {
    if (this.discarded) return [];

    const results: ToolResultBlock[] = [];

    for (const tracked of this.tools) {
      if (this.discarded) break;
      if (config.signal?.aborted) break;

      // 未开始执行的 → 现在执行
      if (tracked.status === 'queued') {
        this.startExecution(tracked);
      }

      // 等待完成
      if (tracked.promise) {
        tracked.result = await tracked.promise;
      }

      const result = tracked.result ?? { content: '工具执行未返回结果', isError: true };

      // 发送 tool_end 事件
      config.onEvent({
        type: 'tool_end',
        toolName: tracked.block.name,
        toolResult: result.content,
        isError: result.isError ?? false,
        timestamp: Date.now(),
      });

      results.push({
        type: 'tool_result',
        tool_use_id: tracked.block.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    // 清空队列
    this.tools = [];
    this.activeConcurrent = 0;

    return results;
  }

  /**
   * 标记为已丢弃 (流式回退时清理)
   *
   * 参考 Claude Code: StreamingToolExecutor.discard()
   * 防止孤立的 tool_results 泄漏到重试请求中
   */
  discard(): void {
    this.discarded = true;
  }

  /** 队列中的工具数量 */
  get size(): number {
    return this.tools.length;
  }

  /** 是否有工具正在执行 */
  get hasExecuting(): boolean {
    return this.tools.some(t => t.status === 'executing');
  }

  // ─── Private ───

  private startExecution(tracked: TrackedTool): void {
    tracked.status = 'executing';
    if (tracked.isConcurrencySafe) {
      this.activeConcurrent++;
    }

    tracked.promise = this.executeSingle(tracked.block)
      .then(result => {
        tracked.status = 'completed';
        tracked.result = result;
        if (tracked.isConcurrencySafe) {
          this.activeConcurrent--;
        }
        return result;
      })
      .catch(err => {
        tracked.status = 'completed';
        if (tracked.isConcurrencySafe) {
          this.activeConcurrent--;
        }
        const result: ToolCallResult = {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
        tracked.result = result;
        return result;
      });
  }

  private async executeSingle(block: ToolUseBlock): Promise<ToolCallResult> {
    const tool = this.toolMap.get(block.name);
    if (!tool) {
      return { content: `未知工具: ${block.name}`, isError: true };
    }

    try {
      return await tool.call(block.input);
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  }
}
