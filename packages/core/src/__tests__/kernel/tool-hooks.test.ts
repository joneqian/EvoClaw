import { describe, it, expect, vi } from 'vitest';
import {
  ToolHookRegistry,
  stricterPermission,
  type ToolHookContext,
} from '../../agent/kernel/tool-hooks.js';

const CTX: ToolHookContext = { agentId: 'test', sessionId: 's1' };

// ═══════════════════════════════════════════════════════════════════════════
// stricterPermission
// ═══════════════════════════════════════════════════════════════════════════

describe('stricterPermission', () => {
  it('deny > ask > allow', () => {
    expect(stricterPermission('allow', 'deny')).toBe('deny');
    expect(stricterPermission('deny', 'allow')).toBe('deny');
    expect(stricterPermission('ask', 'deny')).toBe('deny');
    expect(stricterPermission('allow', 'ask')).toBe('ask');
    expect(stricterPermission('ask', 'allow')).toBe('ask');
  });

  it('undefined 退让给有值的一方', () => {
    expect(stricterPermission(undefined, 'allow')).toBe('allow');
    expect(stricterPermission('deny', undefined)).toBe('deny');
    expect(stricterPermission(undefined, undefined)).toBeUndefined();
  });

  it('相同值返回自身', () => {
    expect(stricterPermission('deny', 'deny')).toBe('deny');
    expect(stricterPermission('allow', 'allow')).toBe('allow');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PreToolUse — 权限聚合
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolHookRegistry — PreToolUse 权限聚合', () => {
  it('多个 Hook: deny > allow (最严格者胜出)', async () => {
    const registry = new ToolHookRegistry();

    // 第一个 Hook 返回 allow
    registry.registerPre(async () => ({ permissionBehavior: 'allow' as const }));
    // 第二个 Hook 返回 deny
    registry.registerPre(async () => ({ permissionBehavior: 'deny' as const }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.permissionBehavior).toBe('deny');
  });

  it('多个 Hook: ask > allow', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => ({ permissionBehavior: 'allow' as const }));
    registry.registerPre(async () => ({ permissionBehavior: 'ask' as const }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.permissionBehavior).toBe('ask');
  });

  it('additionalContexts 合并所有', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => ({ additionalContexts: ['ctx1'] }));
    registry.registerPre(async () => ({ additionalContexts: ['ctx2', 'ctx3'] }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.additionalContexts).toEqual(['ctx1', 'ctx2', 'ctx3']);
  });

  it('blockingError 立即中断', async () => {
    const registry = new ToolHookRegistry();
    const thirdHook = vi.fn(async () => ({ permissionBehavior: 'deny' as const }));

    registry.registerPre(async () => null); // no-op
    registry.registerPre(async () => ({ blockingError: 'blocked!' }));
    registry.registerPre(thirdHook);

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.blockingError).toBe('blocked!');
    expect(thirdHook).not.toHaveBeenCalled();
  });

  it('updatedInput: 最后一个生效（链式修改）', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => ({ updatedInput: { a: 1 } }));
    registry.registerPre(async () => ({ updatedInput: { a: 2, b: 3 } }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.updatedInput).toEqual({ a: 2, b: 3 });
  });

  it('preventContinuation: 任一 true 则 true', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => ({ preventContinuation: false }));
    registry.registerPre(async () => ({ preventContinuation: true }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.preventContinuation).toBe(true);
  });

  it('空注册表返回 null', async () => {
    const registry = new ToolHookRegistry();
    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result).toBeNull();
  });

  it('所有 Hook 返回 null 时结果为 null', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => null);
    registry.registerPre(async () => null);

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PostToolUse
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolHookRegistry — PostToolUse', () => {
  it('合并 additionalContexts 和 updatedOutput', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPost(async () => ({
      additionalContexts: ['post1'],
      updatedOutput: 'v1',
    }));
    registry.registerPost(async () => ({
      additionalContexts: ['post2'],
      updatedOutput: 'v2',
    }));

    const result = await registry.runPostHooks('bash', {}, { content: 'ok' }, CTX);
    expect(result?.additionalContexts).toEqual(['post1', 'post2']);
    expect(result?.updatedOutput).toBe('v2'); // 最后一个生效
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PostToolUseFailure
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolHookRegistry — PostToolUseFailure', () => {
  it('错误恢复: 注入上下文', async () => {
    const registry = new ToolHookRegistry();
    registry.registerFailure(async (_tool, _input, error) => ({
      additionalContexts: [`建议: 错误 "${error}" 可尝试重试`],
    }));

    const result = await registry.runFailureHooks('bash', {}, 'timeout', CTX);
    expect(result?.additionalContexts?.[0]).toContain('timeout');
  });

  it('空注册表返回 null', async () => {
    const registry = new ToolHookRegistry();
    const result = await registry.runFailureHooks('bash', {}, 'err', CTX);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 超时控制
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolHookRegistry — 超时控制', () => {
  it('超时的 Hook 返回 null 不阻断管线', async () => {
    const registry = new ToolHookRegistry({ defaultTimeoutMs: 50 });

    // 慢 Hook: 200ms
    registry.registerPre(async () => {
      await new Promise(r => setTimeout(r, 200));
      return { permissionBehavior: 'deny' as const };
    });
    // 快 Hook
    registry.registerPre(async () => ({ permissionBehavior: 'allow' as const }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    // 慢 Hook 超时返回 null，快 Hook 的 allow 生效
    expect(result?.permissionBehavior).toBe('allow');
  }, 5000);

  it('Hook 抛异常时静默返回 null', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => { throw new Error('boom'); });
    registry.registerPre(async () => ({ permissionBehavior: 'allow' as const }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.permissionBehavior).toBe('allow');
  });

  it('单个 Hook 可覆盖超时', async () => {
    const registry = new ToolHookRegistry({ defaultTimeoutMs: 50 });

    // 覆盖超时为 500ms
    registry.registerPre(async () => {
      await new Promise(r => setTimeout(r, 100));
      return { permissionBehavior: 'deny' as const };
    }, { timeoutMs: 500 });

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.permissionBehavior).toBe('deny'); // 不超时
  }, 5000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Hook 策略 (企业管控)
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolHookRegistry — Hook 策略', () => {
  it('disableAllHooks: 所有 Hook 被跳过', async () => {
    const registry = new ToolHookRegistry({ policy: { disableAllHooks: true } });
    registry.registerPre(async () => ({ permissionBehavior: 'deny' as const }));

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result).toBeNull();
  });

  it('allowManagedHooksOnly: 仅管理员 Hook 执行', async () => {
    const registry = new ToolHookRegistry({ policy: { allowManagedHooksOnly: true } });

    // 非管理员 Hook
    registry.registerPre(async () => ({ permissionBehavior: 'deny' as const }));
    // 管理员 Hook
    registry.registerPre(async () => ({ permissionBehavior: 'allow' as const }), { managed: true });

    const result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.permissionBehavior).toBe('allow'); // 只有 managed Hook 执行
  });

  it('updatePolicy 运行时更新', async () => {
    const registry = new ToolHookRegistry();
    registry.registerPre(async () => ({ permissionBehavior: 'deny' as const }));

    // 初始无策略 → Hook 执行
    let result = await registry.runPreHooks('bash', {}, CTX);
    expect(result?.permissionBehavior).toBe('deny');

    // 更新策略 → Hook 被禁用
    registry.updatePolicy({ disableAllHooks: true });
    result = await registry.runPreHooks('bash', {}, CTX);
    expect(result).toBeNull();
  });

  it('策略对 PostToolUse 和 Failure 同样生效', async () => {
    const registry = new ToolHookRegistry({ policy: { disableAllHooks: true } });
    registry.registerPost(async () => ({ updatedOutput: 'x' }));
    registry.registerFailure(async () => ({ additionalContexts: ['x'] }));

    expect(await registry.runPostHooks('bash', {}, { content: '' }, CTX)).toBeNull();
    expect(await registry.runFailureHooks('bash', {}, 'err', CTX)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Hook 数量统计
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolHookRegistry — 计数', () => {
  it('preHookCount / postHookCount / failureHookCount', () => {
    const registry = new ToolHookRegistry();
    expect(registry.preHookCount).toBe(0);
    expect(registry.postHookCount).toBe(0);
    expect(registry.failureHookCount).toBe(0);

    registry.registerPre(async () => null);
    registry.registerPost(async () => null);
    registry.registerFailure(async () => null);

    expect(registry.preHookCount).toBe(1);
    expect(registry.postHookCount).toBe(1);
    expect(registry.failureHookCount).toBe(1);
  });
});
