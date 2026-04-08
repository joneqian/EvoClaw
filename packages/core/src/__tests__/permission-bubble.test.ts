/**
 * 权限冒泡管理器测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PermissionBubbleManager,
  resolvePermissionDecision,
  getGlobalPendingCount,
} from '../agent/permission-bubble.js';

describe('PermissionBubbleManager', () => {
  let manager: PermissionBubbleManager;

  beforeEach(() => {
    manager = new PermissionBubbleManager(5000); // 5s 超时
  });

  afterEach(() => {
    manager.dispose();
  });

  it('createSubAgentInterceptFn 允许时直接通过', async () => {
    const parentFn = vi.fn().mockResolvedValue(null); // 允许
    const emitFn = vi.fn();

    const interceptFn = manager.createSubAgentInterceptFn(parentFn, 'task-1', emitFn);
    const result = await interceptFn('read', { path: '/tmp/test' });

    expect(result).toBeNull(); // 允许
    expect(emitFn).not.toHaveBeenCalled(); // 不冒泡
  });

  it('createSubAgentInterceptFn 拒绝时冒泡等待用户决策', async () => {
    const parentFn = vi.fn().mockResolvedValue('需要「shell」权限');
    const emitFn = vi.fn();

    const interceptFn = manager.createSubAgentInterceptFn(parentFn, 'task-1', emitFn);

    // 启动拦截（会阻塞等待决策）
    const resultPromise = interceptFn('bash', { command: 'ls' });
    await new Promise(resolve => setTimeout(resolve, 10));

    // 验证 SSE 事件已发射（onEmit 接收 PermissionBubbleRequest 对象）
    expect(emitFn).toHaveBeenCalledTimes(1);
    const request = emitFn.mock.calls[0]![0];

    // 全局注册表应有待决请求
    expect(getGlobalPendingCount()).toBe(1);

    // 用户允许
    const resolved = resolvePermissionDecision(request.requestId, 'allow');
    expect(resolved).toBe(true);

    const result = await resultPromise;
    expect(result).toBeNull(); // 允许继续

    // 请求已解决
    expect(getGlobalPendingCount()).toBe(0);
  });

  it('用户拒绝时返回拒绝字符串', async () => {
    const parentFn = vi.fn().mockResolvedValue('需要「network」权限');
    const emitFn = vi.fn();

    const interceptFn = manager.createSubAgentInterceptFn(parentFn, 'task-1', emitFn);
    const resultPromise = interceptFn('web_fetch', { url: 'https://example.com' });
    await new Promise(resolve => setTimeout(resolve, 10));

    const request = emitFn.mock.calls[0]![0];
    resolvePermissionDecision(request.requestId, 'deny');

    const result = await resultPromise;
    expect(result).toBe('需要「network」权限'); // 拒绝
  });

  it('超时自动拒绝', async () => {
    const shortManager = new PermissionBubbleManager(100); // 100ms 超时
    const parentFn = vi.fn().mockResolvedValue('需要「shell」权限');
    const emitFn = vi.fn();

    const interceptFn = shortManager.createSubAgentInterceptFn(parentFn, 'task-1', emitFn);
    const result = await interceptFn('bash', { command: 'rm file' });

    // 超时后自动拒绝
    expect(result).toBe('需要「shell」权限');
    expect(getGlobalPendingCount()).toBe(0);

    shortManager.dispose();
  });

  it('resolvePermissionDecision 对不存在的 requestId 返回 false', () => {
    const result = resolvePermissionDecision('nonexistent', 'allow');
    expect(result).toBe(false);
  });

  it('dispose 拒绝所有待决请求', async () => {
    const parentFn = vi.fn().mockResolvedValue('需要权限');
    const emitFn = vi.fn();

    const interceptFn = manager.createSubAgentInterceptFn(parentFn, 'task-1', emitFn);
    const resultPromise = interceptFn('bash', { command: 'ls' });

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(manager.pendingCount).toBe(1);

    manager.dispose();

    const result = await resultPromise;
    expect(result).toBe('需要权限'); // dispose 导致拒绝
    expect(manager.pendingCount).toBe(0);
    expect(getGlobalPendingCount()).toBe(0);
  });

  it('emitFn 发射的请求包含 subagentTaskId', async () => {
    const parentFn = vi.fn().mockResolvedValue('需要「mcp」权限');
    const emitFn = vi.fn();

    const interceptFn = manager.createSubAgentInterceptFn(parentFn, 'my-task-123', emitFn);
    const resultPromise = interceptFn('mcp_call', {});
    await new Promise(resolve => setTimeout(resolve, 10));

    const request = emitFn.mock.calls[0]![0];

    expect(request.subagentTaskId).toBe('my-task-123');
    expect(request.requestId).toBeTruthy();
    expect(request.toolName).toBe('mcp_call');

    // 清理
    resolvePermissionDecision(request.requestId, 'deny');
    await resultPromise;
  });

  it('无 parentInterceptFn 时全部允许', async () => {
    const emitFn = vi.fn();
    const interceptFn = manager.createSubAgentInterceptFn(undefined, 'task-1', emitFn);

    const result = await interceptFn('bash', { command: 'rm -rf /' });
    expect(result).toBeNull();
    expect(emitFn).not.toHaveBeenCalled();
  });

  it('多个并发权限请求各自独立', async () => {
    const parentFn = vi.fn().mockResolvedValue('需要权限');
    const emitFn = vi.fn();

    const fn1 = manager.createSubAgentInterceptFn(parentFn, 'task-1', emitFn);
    const fn2 = manager.createSubAgentInterceptFn(parentFn, 'task-2', emitFn);

    const p1 = fn1('bash', { command: 'a' });
    const p2 = fn2('bash', { command: 'b' });

    // 等待微任务完成（async 函数内部 await 需要一个 tick）
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(manager.pendingCount).toBe(2);

    const req1 = emitFn.mock.calls[0]![0];
    const req2 = emitFn.mock.calls[1]![0];

    // 允许第一个，拒绝第二个
    resolvePermissionDecision(req1.requestId, 'allow');
    resolvePermissionDecision(req2.requestId, 'deny');

    expect(await p1).toBeNull();
    expect(await p2).toBe('需要权限');
  });
});
