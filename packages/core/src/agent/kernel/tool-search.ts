/**
 * ToolSearchTool — 延迟工具发现机制
 *
 * 参考 Claude Code ToolSearchTool:
 * - 模型通过关键词搜索发现延迟加载的工具
 * - 返回匹配工具的名称和完整描述
 * - 匹配基于每个工具的 searchHint 字段
 *
 * 使用场景:
 * 大量不常用工具标记 shouldDefer=true，初始 prompt 不含其完整 schema。
 * 模型需要某功能时调用 ToolSearch，按 searchHint 模糊匹配返回完整描述。
 */

import type { KernelTool, ToolCallResult } from './types.js';

/**
 * 创建 ToolSearchTool 实例
 *
 * @param allTools 所有可用工具（含 deferred）
 * @returns KernelTool — ToolSearch 工具
 */
export function createToolSearchTool(allTools: readonly KernelTool[]): KernelTool {
  return {
    name: 'ToolSearch',
    description: '搜索可用工具。当你需要的功能不在已加载工具列表中时，用关键词搜索发现更多工具。',
    searchHint: 'find discover search tools capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词（如 "notebook jupyter"、"cron schedule"、"web fetch"）',
        },
        max_results: {
          type: 'number',
          description: '最大返回数量（默认 5）',
        },
      },
      required: ['query'],
    },

    async call(input: Record<string, unknown>): Promise<ToolCallResult> {
      const query = String(input.query ?? '').toLowerCase().trim();
      const maxResults = Number(input.max_results) || 5;

      if (!query) {
        return { content: '请提供搜索关键词', isError: true };
      }

      const queryTerms = query.split(/\s+/);

      // 评分：匹配 name + searchHint + description
      const scored = allTools
        .map(tool => {
          const haystack = [
            tool.name.toLowerCase(),
            (tool.searchHint ?? '').toLowerCase(),
            tool.description.toLowerCase(),
          ].join(' ');

          let score = 0;
          for (const term of queryTerms) {
            if (haystack.includes(term)) score++;
            // name 精确匹配加分
            if (tool.name.toLowerCase() === term) score += 3;
            // name 包含加分
            if (tool.name.toLowerCase().includes(term)) score += 1;
          }
          return { tool, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      if (scored.length === 0) {
        return { content: `未找到匹配 "${query}" 的工具` };
      }

      const lines = scored.map(({ tool }) => {
        const hint = tool.searchHint ? ` (${tool.searchHint})` : '';
        const deferred = tool.shouldDefer ? ' [延迟加载]' : '';
        return `- **${tool.name}**${hint}${deferred}: ${tool.description}`;
      });

      return { content: lines.join('\n') };
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

/**
 * 将工具列表分为 eager（立即加载）和 deferred（延迟加载）
 *
 * @param tools 所有工具
 * @returns { eager: 完整工具, deferred: 仅名称+defer标记 }
 */
export function partitionToolsByDefer(tools: readonly KernelTool[]): {
  eager: KernelTool[];
  deferred: Array<{ name: string; description: string }>;
} {
  const eager: KernelTool[] = [];
  const deferred: Array<{ name: string; description: string }> = [];

  for (const tool of tools) {
    if (tool.shouldDefer) {
      deferred.push({ name: tool.name, description: tool.description });
    } else {
      eager.push(tool);
    }
  }

  return { eager, deferred };
}
