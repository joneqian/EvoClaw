/**
 * StreamingToolExecutor 测试
 *
 * 覆盖:
 * - 并发安全工具立即预执行
 * - 串行工具等待 collectResults
 * - 结果按入队顺序返回
 * - discard 后不再执行
 * - 未知工具返回错误
 * - 工具执行异常处理
 */

import { describe, it, expect, vi } from 'vitest';
import { StreamingToolExecutor } from '../../agent/kernel/streaming-tool-executor.js';
import type { KernelTool, ToolUseBlock, ToolCallResult } from '../../agent/kernel/types.js';

function mockTool(name: string, opts?: {
  concurrent?: boolean;
  result?: string;
  delay?: number;
  error?: string;
}): KernelTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: {} },
    async call(): Promise<ToolCallResult> {
      if (opts?.delay) await new Promise(r => setTimeout(r, opts.delay));
      if (opts?.error) throw new Error(opts.error);
      return { content: opts?.result ?? `${name} result` };
    },
    isReadOnly: () => opts?.concurrent ?? false,
    isConcurrencySafe: () => opts?.concurrent ?? false,
  };
}

function toolUseBlock(id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

function noopOnEvent() {
  return { onEvent: () => {} };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('StreamingToolExecutor', () => {
  it('should execute concurrent-safe tools immediately on enqueue', async () => {
    const tools = [mockTool('read', { concurrent: true, result: 'file content' })];
    const executor = new StreamingToolExecutor(tools);

    executor.enqueue(toolUseBlock('call_1', 'read'));

    // 不需要 collectResults 就已经开始执行了
    expect(executor.hasExecuting).toBe(true);

    const results = await executor.collectResults(noopOnEvent());
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('file content');
    expect(results[0]!.tool_use_id).toBe('call_1');
  });

  it('should NOT execute serial tools until collectResults', async () => {
    const callSpy = vi.fn().mockResolvedValue({ content: 'ok' });
    const tools: KernelTool[] = [{
      name: 'write',
      description: 'write tool',
      inputSchema: { type: 'object', properties: {} },
      call: callSpy,
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
    }];
    const executor = new StreamingToolExecutor(tools);

    executor.enqueue(toolUseBlock('call_1', 'write'));

    // 串行工具不应该被预执行
    expect(callSpy).not.toHaveBeenCalled();

    const results = await executor.collectResults(noopOnEvent());
    expect(callSpy).toHaveBeenCalledOnce();
    expect(results[0]!.content).toBe('ok');
  });

  it('should return results in enqueue order', async () => {
    const tools = [
      mockTool('read', { concurrent: true, result: 'r1', delay: 50 }),
      mockTool('grep', { concurrent: true, result: 'r2', delay: 10 }),
    ];
    const executor = new StreamingToolExecutor(tools);

    executor.enqueue(toolUseBlock('call_1', 'read'));
    executor.enqueue(toolUseBlock('call_2', 'grep'));

    const results = await executor.collectResults(noopOnEvent());

    // 即使 grep 先完成，结果仍按入队顺序
    expect(results[0]!.tool_use_id).toBe('call_1');
    expect(results[0]!.content).toBe('r1');
    expect(results[1]!.tool_use_id).toBe('call_2');
    expect(results[1]!.content).toBe('r2');
  });

  it('should handle mixed concurrent and serial tools', async () => {
    const tools = [
      mockTool('read', { concurrent: true, result: 'read result' }),
      mockTool('write', { concurrent: false, result: 'write result' }),
    ];
    const executor = new StreamingToolExecutor(tools);

    executor.enqueue(toolUseBlock('call_1', 'read'));
    executor.enqueue(toolUseBlock('call_2', 'write'));

    const results = await executor.collectResults(noopOnEvent());
    expect(results).toHaveLength(2);
    expect(results[0]!.content).toBe('read result');
    expect(results[1]!.content).toBe('write result');
  });

  it('should handle unknown tool', async () => {
    const executor = new StreamingToolExecutor([]);

    executor.enqueue(toolUseBlock('call_1', 'nonexistent'));
    const results = await executor.collectResults(noopOnEvent());

    expect(results[0]!.is_error).toBe(true);
    expect(results[0]!.content).toContain('未知工具');
  });

  it('should handle tool execution error', async () => {
    const tools = [mockTool('failing', { error: 'boom' })];
    const executor = new StreamingToolExecutor(tools);

    executor.enqueue(toolUseBlock('call_1', 'failing'));
    const results = await executor.collectResults(noopOnEvent());

    expect(results[0]!.is_error).toBe(true);
    expect(results[0]!.content).toBe('boom');
  });

  it('should emit tool_end events', async () => {
    const tools = [mockTool('read', { concurrent: true, result: 'ok' })];
    const executor = new StreamingToolExecutor(tools);
    const events: Array<{ type: string }> = [];

    executor.enqueue(toolUseBlock('call_1', 'read'));
    await executor.collectResults({ onEvent: (e) => events.push(e) });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('tool_end');
  });

  it('should not execute after discard', async () => {
    const callSpy = vi.fn().mockResolvedValue({ content: 'ok' });
    const tools: KernelTool[] = [{
      name: 'test', description: '', inputSchema: {},
      call: callSpy,
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
    }];
    const executor = new StreamingToolExecutor(tools);

    executor.enqueue(toolUseBlock('call_1', 'test'));
    executor.discard();

    const results = await executor.collectResults(noopOnEvent());
    expect(results).toHaveLength(0);
    expect(callSpy).not.toHaveBeenCalled();
  });

  it('should respect maxConcurrency', async () => {
    let running = 0;
    let maxRunning = 0;
    const tools: KernelTool[] = [{
      name: 'slow',
      description: 'slow tool',
      inputSchema: {},
      async call() {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => setTimeout(r, 50));
        running--;
        return { content: 'done' };
      },
      isReadOnly: () => true,
      isConcurrencySafe: () => true,
    }];

    const executor = new StreamingToolExecutor(tools, 2); // max 2 concurrent

    // 入队 4 个
    for (let i = 0; i < 4; i++) {
      executor.enqueue(toolUseBlock(`call_${i}`, 'slow'));
    }

    const results = await executor.collectResults(noopOnEvent());
    expect(results).toHaveLength(4);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });
});
