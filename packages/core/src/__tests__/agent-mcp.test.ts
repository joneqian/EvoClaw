import { describe, it, expect, vi } from 'vitest';
import { bridgeMcpToolsForAgent } from '../mcp/mcp-tool-bridge.js';
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

const TOOLS: McpToolInfo[] = [
  { name: 'query', description: 'SAP 查询', inputSchema: {}, serverName: 'sap' },
  { name: 'search', description: 'CRM 搜索', inputSchema: {}, serverName: 'crm' },
  { name: 'approve', description: '飞书审批', inputSchema: {}, serverName: 'feishu' },
  { name: 'send', description: '飞书发送', inputSchema: {}, serverName: 'feishu' },
];

describe('bridgeMcpToolsForAgent', () => {
  it('serverNames 为 undefined 时返回全部 MCP 工具', () => {
    const manager = createMockManager(TOOLS);
    const result = bridgeMcpToolsForAgent(manager, undefined);
    expect(result).toHaveLength(4);
  });

  it('serverNames 为空数组时返回全部 MCP 工具', () => {
    const manager = createMockManager(TOOLS);
    const result = bridgeMcpToolsForAgent(manager, []);
    expect(result).toHaveLength(4);
  });

  it('按指定服务器名过滤工具', () => {
    const manager = createMockManager(TOOLS);
    const result = bridgeMcpToolsForAgent(manager, ['sap', 'feishu']);

    expect(result).toHaveLength(3);
    const names = result.map(t => t.name);
    expect(names).toContain('mcp_sap_query');
    expect(names).toContain('mcp_feishu_approve');
    expect(names).toContain('mcp_feishu_send');
    expect(names).not.toContain('mcp_crm_search');
  });

  it('指定不存在的服务器名返回空', () => {
    const manager = createMockManager(TOOLS);
    const result = bridgeMcpToolsForAgent(manager, ['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('单个服务器名过滤', () => {
    const manager = createMockManager(TOOLS);
    const result = bridgeMcpToolsForAgent(manager, ['crm']);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('mcp_crm_search');
  });

  it('排除已有工具名冲突', () => {
    const manager = createMockManager(TOOLS);
    const existing = new Set(['mcp_sap_query']);
    const result = bridgeMcpToolsForAgent(manager, ['sap'], existing);

    expect(result).toHaveLength(0);
  });

  it('无 MCP 工具时返回空数组', () => {
    const manager = createMockManager([]);
    const result = bridgeMcpToolsForAgent(manager, ['sap']);
    expect(result).toHaveLength(0);
  });
});
