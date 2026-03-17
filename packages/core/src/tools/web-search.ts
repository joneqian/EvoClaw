/**
 * Web 搜索工具 — Brave Search API 集成
 * 注入为 Agent 工具，让 Agent 具备联网搜索能力
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';

/** 创建 web_search 工具 */
export function createWebSearchTool(opts: { braveApiKey: string }): ToolDefinition {
  const { braveApiKey } = opts;

  return {
    name: 'web_search',
    description: '搜索互联网获取最新信息。返回网页搜索结果列表，包含标题、URL 和摘要。适用于查询新闻、技术文档、产品信息等实时内容。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或自然语言查询' },
        count: { type: 'number', description: '返回结果数量（默认 5，最大 20）' },
        freshness: { type: 'string', description: '时效性过滤：pd（过去一天）、pw（过去一周）、pm（过去一月）' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = args['query'] as string;
      const count = Math.min((args['count'] as number) ?? 5, 20);
      const freshness = args['freshness'] as string | undefined;

      if (!query) return '错误：缺少 query 参数';

      const params = new URLSearchParams({
        q: query,
        count: String(count),
      });
      if (freshness) params.set('freshness', freshness);

      try {
        const response = await fetch(
          `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
          {
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': braveApiKey,
            },
            signal: AbortSignal.timeout(15_000),
          },
        );

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          return `搜索失败: HTTP ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`;
        }

        const data = await response.json() as BraveSearchResponse;
        const results = data.web?.results ?? [];

        if (results.length === 0) {
          return `未找到与 "${query}" 相关的搜索结果。`;
        }

        const formatted = results.map((r, i) =>
          `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? '无摘要'}`
        ).join('\n\n');

        return `搜索 "${query}" 的结果（共 ${results.length} 条）：\n\n${formatted}`;
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          return '搜索超时（15 秒），请稍后重试。';
        }
        return `搜索出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** Brave Search API 响应类型（仅需要的字段） */
interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title: string;
      url: string;
      description?: string;
    }>;
  };
}
