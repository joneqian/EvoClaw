import { describe, it, expect, beforeEach } from 'vitest';
import {
  setToolInjectorConfig,
  getInjectedTools,
  permissionInterceptor,
  type ToolDefinition,
  type ToolInjectorConfig,
} from '../bridge/tool-injector.js';

/** 创建测试工具 */
function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `测试工具: ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => `${name} 执行结果`,
  };
}

describe('ToolInjector 5 阶段注入', () => {
  beforeEach(() => {
    // 重置配置
    setToolInjectorConfig({});
  });

  it('无配置时返回空工具列表', () => {
    const tools = getInjectedTools();
    expect(tools).toEqual([]);
  });

  it('阶段 3: 注入 EvoClaw 工具', () => {
    const evoTools = [makeTool('memory_search'), makeTool('memory_get')];
    setToolInjectorConfig({ evoClawTools: evoTools });

    const tools = getInjectedTools();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toEqual(['memory_search', 'memory_get']);
  });

  it('阶段 4: 注入 Channel 工具', () => {
    const channelTools = [makeTool('desktop_notify'), makeTool('feishu_send')];
    setToolInjectorConfig({ channelTools });

    const tools = getInjectedTools();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toEqual(['desktop_notify', 'feishu_send']);
  });

  it('阶段 3+4: 同时注入 EvoClaw + Channel 工具', () => {
    setToolInjectorConfig({
      evoClawTools: [makeTool('memory_search')],
      channelTools: [makeTool('desktop_notify')],
    });

    const tools = getInjectedTools();
    expect(tools).toHaveLength(2);
    // EvoClaw 工具在前，Channel 工具在后
    expect(tools[0]!.name).toBe('memory_search');
    expect(tools[1]!.name).toBe('desktop_notify');
  });

  it('工具应可执行', async () => {
    const tool = makeTool('test_tool');
    setToolInjectorConfig({ evoClawTools: [tool] });

    const tools = getInjectedTools();
    const result = await tools[0]!.execute({});
    expect(result).toBe('test_tool 执行结果');
  });

  it('重新配置应替换工具列表', () => {
    setToolInjectorConfig({ evoClawTools: [makeTool('tool_a')] });
    expect(getInjectedTools()).toHaveLength(1);

    setToolInjectorConfig({ evoClawTools: [makeTool('tool_b'), makeTool('tool_c')] });
    expect(getInjectedTools()).toHaveLength(2);
    expect(getInjectedTools().map(t => t.name)).toEqual(['tool_b', 'tool_c']);
  });
});

describe('permissionInterceptor', () => {
  beforeEach(() => {
    setToolInjectorConfig({});
  });

  it('无拦截器时默认允许', () => {
    const result = permissionInterceptor('file_read', { path: '/test' });
    expect(result).toEqual({ allowed: true });
  });

  it('无 agentId 时默认允许', () => {
    setToolInjectorConfig({
      interceptor: { intercept: () => ({ allowed: false, reason: 'denied' }) } as any,
      // agentId 未设置
    });
    const result = permissionInterceptor('file_read', {});
    expect(result).toEqual({ allowed: true });
  });

  it('有拦截器和 agentId 时应委托拦截器', () => {
    const mockInterceptor = {
      intercept: (agentId: string, toolName: string, _args: Record<string, unknown>) => {
        if (toolName === 'shell_exec') return { allowed: false, reason: '禁止执行 shell' };
        return { allowed: true };
      },
    };
    setToolInjectorConfig({
      interceptor: mockInterceptor as any,
      agentId: 'test-agent',
    });

    expect(permissionInterceptor('file_read', {})).toEqual({ allowed: true });
    expect(permissionInterceptor('shell_exec', {})).toEqual({ allowed: false, reason: '禁止执行 shell' });
  });
});
