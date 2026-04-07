/**
 * ToolSearchTool + Deferred Loading 测试
 */

import { describe, it, expect } from 'vitest';
import type { KernelTool } from '../../agent/kernel/types.js';
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

  const searchTool = createToolSearchTool(() => tools);

  it('应按关键词匹配工具', async () => {
    const result = await searchTool.call({ query: 'cron schedule' });
    expect(result.content).toContain('CronCreate');
  });

  it('select: 精确选择应返回完整 schema', async () => {
    const result = await searchTool.call({ query: 'select:read,web_fetch' });
    expect(result.content).toContain('"name": "read"');
    expect(result.content).toContain('"name": "web_fetch"');
  });

  it('无匹配时应返回提示', async () => {
    const result = await searchTool.call({ query: 'nonexistent_xyz' });
    expect(result.content).toContain('No matching tools found');
  });

  it('空查询应返回无匹配', async () => {
    const result = await searchTool.call({ query: '' });
    expect(result.content).toContain('No matching tools found');
  });

  it('应限制最大返回数', async () => {
    // "files" 匹配 read 和 write 的 searchHint
    const result = await searchTool.call({ query: 'files', max_results: 1 });
    expect(result.content).toContain('Found 1 tool');
  });

  it('ToolSearch 自身应为只读 + 并发安全', () => {
    expect(searchTool.isReadOnly()).toBe(true);
    expect(searchTool.isConcurrencySafe()).toBe(true);
  });

  it('onDiscover 回调应被调用', async () => {
    const discovered: string[] = [];
    const toolWithCallback = createToolSearchTool(() => tools, (names) => discovered.push(...names));
    await toolWithCallback.call({ query: 'select:CronCreate' });
    expect(discovered).toContain('CronCreate');
  });
});
