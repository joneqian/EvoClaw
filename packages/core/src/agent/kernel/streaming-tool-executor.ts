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

  /**
   * 三层 AbortController 架构 (参考 Claude Code):
   *
   * queryAbortSignal (外部传入，query-loop 级)
   *   └─ siblingAbortController (StreamingToolExecutor 私有)
   *        └─ toolAbortController (每工具独立，在 startExecution 中创建)
   *
   * 取消语义:
   * - Bash 错误 → abort siblingController → 取消兄弟工具 (不结束 turn)
   * - 权限拒绝 → 错误冒泡到 query-loop (结束 turn)
   * - 用户中断 → queryAbortSignal → 取消所有
   */
  private siblingAbortController = new AbortController();
  private queryAbortSignal?: AbortSignal;
  private hasErrored = false;
  private erroredToolName: string | undefined;
  /** onEvent 回调（在 collectResults 时设置，用于进度桥接） */
  private onEvent?: (event: import('../types.js').RuntimeEvent) => void;

  /** Bash 工具名称 — 只有 Bash 错误会取消兄弟 */
  private static readonly BASH_TOOL_NAME = 'bash';

  constructor(tools: readonly KernelTool[], maxConcurrency = 8, queryAbortSignal?: AbortSignal) {
    this.toolMap = new Map(tools.map(t => [t.name, t]));
    this.maxConcurrency = maxConcurrency;
    this.queryAbortSignal = queryAbortSignal;

    // query-level abort → 级联到 sibling level
    if (queryAbortSignal) {
      queryAbortSignal.addEventListener('abort', () => {
        this.siblingAbortController.abort('query_abort');
      }, { once: true });
    }
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
    // 存储 onEvent 供 executeSingle 中的进度回调使用
    this.onEvent = config.onEvent;

    const results: ToolResultBlock[] = [];

    for (const tracked of this.tools) {
      if (this.discarded) break;
      if (config.signal?.aborted) break;

      // 兄弟错误: 为未完成的工具生成合成错误
      if (this.hasErrored && tracked.status === 'queued') {
        const syntheticResult: ToolCallResult = {
          content: `已中止: 兄弟工具 ${this.erroredToolName ?? 'bash'} 执行失败`,
          isError: true,
        };
        config.onEvent({
          type: 'tool_end',
          toolName: tracked.block.name,
          toolResult: syntheticResult.content,
          isError: true,
          timestamp: Date.now(),
        });
        results.push({
          type: 'tool_result',
          tool_use_id: tracked.block.id,
          content: syntheticResult.content,
          is_error: true,
        });
        continue;
      }

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
   * 丢弃并清理 (流式回退时)
   *
   * 参考 Claude Code: StreamingToolExecutor.discard()
   * - 取消所有正在执行的工具
   * - 为所有 queued 工具生成合成错误
   * - 防止孤立的 tool_results 泄漏到重试请求中
   */
  discard(): void {
    this.discarded = true;
    // 取消所有正在执行的工具
    this.siblingAbortController.abort('streaming_fallback');
    // 为所有 queued 工具生成合成错误
    for (const tracked of this.tools) {
      if (tracked.status === 'queued') {
        tracked.status = 'completed';
        tracked.result = {
          content: `(${tracked.block.name} was not executed — streaming fallback triggered)`,
          isError: true,
        };
      }
    }
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

        // Bash 错误 → 取消兄弟工具 (参考 Claude Code)
        if (result.isError && tracked.block.name === StreamingToolExecutor.BASH_TOOL_NAME) {
          this.hasErrored = true;
          this.erroredToolName = tracked.block.name;
          this.siblingAbortController.abort('sibling_error');
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

        // Bash 错误 → 取消兄弟工具
        if (tracked.block.name === StreamingToolExecutor.BASH_TOOL_NAME) {
          this.hasErrored = true;
          this.erroredToolName = tracked.block.name;
          this.siblingAbortController.abort('sibling_error');
        }

        return result;
      });
  }

  private async executeSingle(block: ToolUseBlock): Promise<ToolCallResult> {
    const tool = this.toolMap.get(block.name);
    if (!tool) {
      return { content: `未知工具: ${block.name}`, isError: true };
    }

    // 三层 AbortController: 创建工具级 controller，链接 siblingAbortController
    const toolAbortController = new AbortController();
    const onSiblingAbort = () => toolAbortController.abort('sibling_error');
    this.siblingAbortController.signal.addEventListener('abort', onSiblingAbort);

    try {
      // 进度回调（通过 onEvent 桥接）
      const onProgress = this.onEvent
        ? (progress: { message: string; data?: unknown }) => {
            this.onEvent!({ type: 'tool_update', toolName: block.name, toolResult: progress.message, timestamp: Date.now() });
          }
        : undefined;
      return await tool.call(block.input, toolAbortController.signal, onProgress);
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    } finally {
      this.siblingAbortController.signal.removeEventListener('abort', onSiblingAbort);
    }
  }
}
