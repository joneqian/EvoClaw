/**
 * ToolSearchTool + Deferred Loading 测试
 */

import { describe, it, expect } from 'vitest';
import type { KernelTool, ToolCallResult } from '../../agent/kernel/types.js';
import { createToolSearchTool } from '../../agent/kernel/tool-search.js';

function makeTool(name: string, opts: Partial<KernelTool> = {}): KernelTool {
  return {
    name,
    description: opts.description ?? `${name} tool`,
    inputSchema: {},
    searchHint: opts.searchHint,
    shouldDefer: opts.shouldDefer,
    call: async () => ({ content: 'ok' }),
    isReadOnly: () => false,
    isConcurrencySafe: () => false,
    ...opts,
  };
}

describe('ToolSearchTool', () => {
  const tools = [
    makeTool('read', { searchHint: 'read files images PDFs text content', description: '读取文件内容' }),
    makeTool('write', { searchHint: 'write create files save output', description: '写入文件' }),
    makeTool('CronCreate', { searchHint: 'cron schedule recurring jobs', shouldDefer: true, description: '创建定时任务' }),
    makeTool('NotebookEdit', { searchHint: 'notebook jupyter edit cells', shouldDefer: true, description: '编辑 Jupyter' }),
    makeTool('web_fetch', { searchHint: 'web fetch url http download', shouldDefer: true, description: '抓取网页' }),
  ];

  const searchTool = createToolSearchTool(tools);

  it('应按关键词匹配工具', async () => {
    const result = await searchTool.call({ query: 'cron schedule' });
    expect(result.content).toContain('CronCreate');
  });

  it('精确名称匹配应得分更高', async () => {
    const result = await searchTool.call({ query: 'read' });
    expect(result.content).toMatch(/^\- \*\*read\*\*/); // read 在第一个
  });

  it('无匹配时应返回提示', async () => {
    const result = await searchTool.call({ query: 'nonexistent_xyz' });
    expect(result.content).toContain('未找到');
  });

  it('空查询应返回错误', async () => {
    const result = await searchTool.call({ query: '' });
    expect(result.isError).toBe(true);
  });

  it('应限制最大返回数', async () => {
    const result = await searchTool.call({ query: 'tool', max_results: 2 });
    const matches = result.content.split('\n').filter(l => l.startsWith('- **'));
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it('ToolSearch 自身应为只读 + 并发安全', () => {
    expect(searchTool.isReadOnly()).toBe(true);
    expect(searchTool.isConcurrencySafe()).toBe(true);
  });
});

