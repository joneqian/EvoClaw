/**
 * 工具适配器测试
 *
 * 覆盖:
 * - adaptEvoclawTool: ToolDefinition → KernelTool 转换
 * - 权限检查集成
 * - 安全守卫集成 (循环检测 + 截断)
 * - 审计日志回调
 * - buildKernelTools: 完整工具池构建 + 去重
 */

import { describe, it, expect, vi } from 'vitest';
import { adaptEvoclawTool, buildKernelTools } from '../../agent/kernel/tool-adapter.js';
import type { ToolAdapterDeps } from '../../agent/kernel/tool-adapter.js';
import type { ToolDefinition } from '../../bridge/tool-injector.js';
import { ToolSafetyGuard } from '../../agent/tool-safety.js';

// ─── Helpers ───

function mockToolDef(name: string, returnValue = 'ok'): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: { input: { type: 'string' } } },
    execute: vi.fn().mockResolvedValue(returnValue),
  };
}

function defaultDeps(overrides?: Partial<ToolAdapterDeps>): ToolAdapterDeps {
  return {
    toolSafety: new ToolSafetyGuard(),
    provider: 'openai',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// adaptEvoclawTool
// ═══════════════════════════════════════════════════════════════════════════

describe('adaptEvoclawTool', () => {
  it('should adapt ToolDefinition to KernelTool', async () => {
    const def = mockToolDef('test_tool', 'result text');
    const tool = adaptEvoclawTool(def, defaultDeps());

    expect(tool.name).toBe('test_tool');
    expect(tool.description).toBe('test_tool tool');

    const result = await tool.call({ input: 'hello' });
    expect(result.content).toBe('result text');
    expect(result.isError).toBeFalsy();
    expect(def.execute).toHaveBeenCalledWith({ input: 'hello' });
  });

  it('should set fail-closed defaults for unknown tools', () => {
    const def = mockToolDef('unknown_custom_tool');
    const tool = adaptEvoclawTool(def, defaultDeps());

    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isConcurrencySafe()).toBe(false);
  });

  it('should mark known read-only tools', () => {
    const readTool = adaptEvoclawTool(mockToolDef('web_search'), defaultDeps());
    expect(readTool.isReadOnly()).toBe(true);
    expect(readTool.isConcurrencySafe()).toBe(true);
  });

  // ─── Permission Integration ───

  it('should block tool when permission denied', async () => {
    const def = mockToolDef('blocked_tool');
    const tool = adaptEvoclawTool(def, defaultDeps({
      permissionFn: vi.fn().mockResolvedValue('不允许此操作'),
    }));

    const result = await tool.call({ input: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('权限拒绝');
    expect(result.content).toContain('不允许此操作');
    expect(def.execute).not.toHaveBeenCalled();
  });

  it('should allow tool when permission passes', async () => {
    const def = mockToolDef('allowed_tool', 'success');
    const tool = adaptEvoclawTool(def, defaultDeps({
      permissionFn: vi.fn().mockResolvedValue(null), // null = allowed
    }));

    const result = await tool.call({ input: 'x' });
    expect(result.content).toBe('success');
    expect(def.execute).toHaveBeenCalled();
  });

  // ─── Safety Guard Integration ───

  it('should block when safety guard detects loop', async () => {
    const safety = new ToolSafetyGuard({ repeatThreshold: 2 });
    const def = mockToolDef('looping_tool', 'same result');
    const tool = adaptEvoclawTool(def, defaultDeps({ toolSafety: safety }));

    // 第一次通过
    await tool.call({ input: 'x' });
    // 第二次 — 触发重复检测
    const result = await tool.call({ input: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('重复调用');
  });

  it('should truncate large results', async () => {
    const safety = new ToolSafetyGuard({ maxResultLength: 100 });
    const longResult = 'x'.repeat(200);
    const def = mockToolDef('big_tool', longResult);
    const tool = adaptEvoclawTool(def, defaultDeps({ toolSafety: safety }));

    const result = await tool.call({ input: 'x' });
    expect(result.content.length).toBeLessThan(200);
    expect(result.content).toContain('截断');
  });

  // ─── Audit Log Integration ───

  it('should call auditFn on success', async () => {
    const auditFn = vi.fn();
    const def = mockToolDef('audited_tool', 'result');
    const tool = adaptEvoclawTool(def, defaultDeps({ auditFn }));

    await tool.call({ input: 'test' });
    expect(auditFn).toHaveBeenCalledOnce();
    expect(auditFn.mock.calls[0]![0]).toMatchObject({
      toolName: 'audited_tool',
      status: 'success',
    });
  });

  it('should call auditFn on permission denied', async () => {
    const auditFn = vi.fn();
    const def = mockToolDef('denied_tool');
    const tool = adaptEvoclawTool(def, defaultDeps({
      auditFn,
      permissionFn: vi.fn().mockResolvedValue('denied'),
    }));

    await tool.call({ input: 'test' });
    expect(auditFn).toHaveBeenCalledOnce();
    expect(auditFn.mock.calls[0]![0]).toMatchObject({
      toolName: 'denied_tool',
      status: 'denied',
    });
  });

  it('should call auditFn on error', async () => {
    const auditFn = vi.fn();
    const def = mockToolDef('error_tool');
    (def.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const tool = adaptEvoclawTool(def, defaultDeps({ auditFn }));

    const result = await tool.call({ input: 'test' });
    expect(result.isError).toBe(true);
    expect(result.content).toBe('boom');
    expect(auditFn).toHaveBeenCalledOnce();
    expect(auditFn.mock.calls[0]![0]).toMatchObject({
      toolName: 'error_tool',
      status: 'error',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildKernelTools
// ═══════════════════════════════════════════════════════════════════════════

describe('buildKernelTools', () => {
  it('should include builtin tools + bash', () => {
    const tools = buildKernelTools({
      builtinContextWindow: 128_000,
      toolSafety: new ToolSafetyGuard(),
      provider: 'openai',
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('read');
    expect(names).toContain('write');
    expect(names).toContain('edit');
    expect(names).toContain('grep');
    expect(names).toContain('find');
    expect(names).toContain('ls');
    expect(names).toContain('bash');
  });

  it('should include custom EvoClaw tools', () => {
    const customTool = mockToolDef('web_search');
    const tools = buildKernelTools({
      builtinContextWindow: 128_000,
      evoClawTools: [customTool],
      toolSafety: new ToolSafetyGuard(),
      provider: 'openai',
    });

    const names = tools.map(t => t.name);
    expect(names).toContain('web_search');
  });

  it('should deduplicate (later overrides earlier)', () => {
    // 自定义 read 工具覆盖内置 read
    const customRead = mockToolDef('read');
    const tools = buildKernelTools({
      builtinContextWindow: 128_000,
      evoClawTools: [customRead],
      toolSafety: new ToolSafetyGuard(),
      provider: 'openai',
    });

    // 只有一个 read
    const readTools = tools.filter(t => t.name === 'read');
    expect(readTools).toHaveLength(1);
  });

  it('should wrap all tools with permission check', async () => {
    const permissionFn = vi.fn().mockResolvedValue('blocked');
    const tools = buildKernelTools({
      builtinContextWindow: 128_000,
      permissionFn,
      toolSafety: new ToolSafetyGuard(),
      provider: 'openai',
    });

    // 任何工具调用都应经过权限检查
    const readTool = tools.find(t => t.name === 'read')!;
    const result = await readTool.call({ file_path: '/tmp/test.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('权限拒绝');
  });
});
