import { describe, it, expect, vi } from 'vitest';
import { bridgeAllMcpTools, mcpToolToDefinition } from '../mcp/mcp-tool-bridge.js';
import type { McpManager } from '../mcp/mcp-client.js';
import type { McpToolInfo } from '@evoclaw/shared';

/** 创建模拟 McpManager */
function createMockManager(tools: McpToolInfo[]): McpManager {
  return {
    getAllTools: () => tools,
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '模拟结果' }],
      isError: false,
    }),
  } as unknown as McpManager;
}

describe('mcpToolToDefinition', () => {
  it('转换 MCP 工具为 EvoClaw ToolDefinition', () => {
    const mcpTool: McpToolInfo = {
      name: 'search',
      description: '搜索文档',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      serverName: 'docs',
    };
    const manager = createMockManager([mcpTool]);
    const def = mcpToolToDefinition(mcpTool, manager);

    expect(def.name).toBe('mcp_docs_search');
    expect(def.description).toBe('搜索文档');
    expect(def.parameters).toEqual(mcpTool.inputSchema);
    expect(typeof def.execute).toBe('function');
  });

  it('execute 调用 manager.callTool 并返回文本', async () => {
    const mcpTool: McpToolInfo = {
      name: 'lookup',
      description: '查询',
      inputSchema: {},
      serverName: 'myserver',
    };
    const manager = createMockManager([mcpTool]);
    const def = mcpToolToDefinition(mcpTool, manager);

    const result = await def.execute({ key: 'val' });
    expect(result).toBe('模拟结果');
    expect(manager.callTool).toHaveBeenCalledWith('myserver', 'lookup', { key: 'val' });
  });
});

describe('bridgeAllMcpTools', () => {
  it('批量转换所有 MCP 工具', () => {
    const tools: McpToolInfo[] = [
      { name: 'tool1', description: 'desc1', inputSchema: {}, serverName: 'server1' },
      { name: 'tool2', description: 'desc2', inputSchema: {}, serverName: 'server2' },
    ];
    const manager = createMockManager(tools);
    const result = bridgeAllMcpTools(manager);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('mcp_server1_tool1');
    expect(result[1].name).toBe('mcp_server2_tool2');
  });

  it('检测保留名称冲突但仍然使用前缀名', () => {
    const tools: McpToolInfo[] = [
      { name: 'read', description: '冲突的 read', inputSchema: {}, serverName: 'ext' },
    ];
    const manager = createMockManager(tools);
    const result = bridgeAllMcpTools(manager);

    // 使用前缀名避免冲突
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('mcp_ext_read');
  });

  it('跳过重复的 qualified name', () => {
    const tools: McpToolInfo[] = [
      { name: 'search', description: 'd1', inputSchema: {}, serverName: 'a' },
      { name: 'search', description: 'd2', inputSchema: {}, serverName: 'a' }, // 重复
    ];
    const manager = createMockManager(tools);
    const result = bridgeAllMcpTools(manager);

    expect(result).toHaveLength(1);
  });

  it('跳过与 existingToolNames 冲突的工具', () => {
    const tools: McpToolInfo[] = [
      { name: 'search', description: 'd1', inputSchema: {}, serverName: 'a' },
    ];
    const manager = createMockManager(tools);
    const existing = new Set(['mcp_a_search']);
    const result = bridgeAllMcpTools(manager, existing);

    expect(result).toHaveLength(0);
  });

  it('空工具列表返回空数组', () => {
    const manager = createMockManager([]);
    const result = bridgeAllMcpTools(manager);
    expect(result).toHaveLength(0);
  });
});
