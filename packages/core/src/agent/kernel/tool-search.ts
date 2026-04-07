/**
 * ToolSearch 工具 — 延迟加载工具的发现和 schema 加载
 *
 * 参考 Claude Code: src/tools/ToolSearchTool/ToolSearchTool.ts
 *
 * 核心设计:
 * - 两种查询模式:
 *   1. "select:ToolName1,ToolName2" — 精确选择，直接返回指定工具的完整 schema
 *   2. 关键词搜索 — 基于 name + searchHint + description 进行匹配
 * - 搜索范围: 所有标记为 shouldDefer=true 的工具
 * - 返回格式: JSON schema 定义，LLM 可据此正确构造工具调用
 */

import type { KernelTool, ToolCallResult } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Deferred Tool 配置
// ═══════════════════════════════════════════════════════════════════════════

/** 建议延迟加载的工具名称 (减少初始 prompt token 开销) */
export const DEFERRED_TOOL_NAMES = new Set([
  'web_search', 'web_fetch',
  'spawn_agent', 'kill_agent', 'steer_agent',
  'knowledge_query',
  'image', 'pdf',
  'apply_patch',
  'browser', 'image_generate',
  'exec_background', 'process',
]);

// ═══════════════════════════════════════════════════════════════════════════
// ToolSearch 工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建 ToolSearch 工具
 *
 * @param getDeferredTools - 返回所有 deferred 工具的闭包 (动态更新，MCP 连接后可能变化)
 * @param onDiscover - 当工具被发现时的回调 (用于将工具加入 discovered set)
 */
export function createToolSearchTool(
  getDeferredTools: () => readonly KernelTool[],
  onDiscover?: (toolNames: string[]) => void,
): KernelTool {
  return {
    name: 'tool_search',
    description: [
      'Search for and load deferred tools by name or keyword.',
      'Use "select:ToolName" for exact match, or keywords to search.',
      'Returns full tool schemas so you can call them correctly.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '"select:ToolName1,ToolName2" for exact selection, or keywords to search by capability',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
    shouldDefer: false,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,

    async call(input: Record<string, unknown>): Promise<ToolCallResult> {
      const query = input.query as string;
      const maxResults = (input.max_results as number) ?? 5;
      const deferred = getDeferredTools();

      let matched: readonly KernelTool[];

      if (query.startsWith('select:')) {
        // 模式 1: 精确选择
        const names = query.slice(7).split(',').map(s => s.trim().toLowerCase());
        matched = deferred.filter(t => names.includes(t.name.toLowerCase()));
      } else {
        // 模式 2: 关键词搜索
        const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
        const scored = deferred.map(t => {
          const haystack = `${t.name} ${t.searchHint ?? ''} ${t.description}`.toLowerCase();
          const score = keywords.reduce((s, kw) => s + (haystack.includes(kw) ? 1 : 0), 0);
          return { tool: t, score };
        });
        matched = scored
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults)
          .map(s => s.tool);
      }

      if (matched.length === 0) {
        return { content: 'No matching tools found. Try different keywords or check tool names.' };
      }

      // 通知调用方这些工具已被发现
      onDiscover?.(matched.map(t => t.name));

      return { content: formatToolSchemas(matched) };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Schema 格式化
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 将工具列表格式化为 LLM 可理解的 schema 定义
 */
function formatToolSchemas(tools: readonly KernelTool[]): string {
  const schemas = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    ...(t.searchHint ? { search_hint: t.searchHint } : {}),
  }));

  return `Found ${tools.length} tool(s):\n\n` +
    schemas.map(s => JSON.stringify(s, null, 2)).join('\n\n---\n\n');
}

/**
 * 为 deferred 工具生成精简的 schema 占位 (用于初始 prompt)
 *
 * 不含完整 input_schema，只有名称和描述，提示 LLM 使用 ToolSearch 加载
 */
export function buildDeferredToolPlaceholder(tool: KernelTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: `[Deferred] ${tool.searchHint ?? tool.description}. Use tool_search with query "select:${tool.name}" to load full schema before calling.`,
    input_schema: {
      type: 'object',
      properties: {
        _deferred: {
          type: 'string',
          description: `This tool's schema is not loaded. Call tool_search first with query "select:${tool.name}".`,
        },
      },
    },
  };
}
