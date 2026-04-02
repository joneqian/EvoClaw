/**
 * Tool Use Summary 生成器 — 用低成本模型生成工具调用摘要
 *
 * 参考 Claude Code: 用 Haiku 生成 ~30 字符 git-commit-subject 风格摘要
 * 例如: "Searched in auth/", "Fixed NPE in UserService"
 *
 * 异步非阻塞，失败静默（非关键功能）
 */

import type { LLMCallFn } from '../memory/memory-extractor.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('tool-use-summary');

/** 工具调用摘要请求 */
export interface ToolSummaryRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
}

export class ToolUseSummaryGenerator {
  constructor(private llmCall: LLMCallFn) {}

  /**
   * 为一组工具调用生成简短摘要
   *
   * @param tools 本轮工具调用列表
   * @returns ~30 字符摘要，git-commit-subject 风格
   */
  async generateSummary(tools: ToolSummaryRequest[]): Promise<string> {
    if (tools.length === 0) return '';

    // 截断每个工具的输入/输出到 300 字符（节省 token）
    const truncated = tools.map(t => ({
      tool: t.toolName,
      input: JSON.stringify(t.toolInput).slice(0, 300),
      result: (t.toolResult ?? '').slice(0, 300),
      error: t.isError ?? false,
    }));

    const system = `You are a tool usage summarizer. Write a short summary label for the following tool calls. Requirements:
- git-commit-subject style, ~30 chars max
- Chinese preferred
- Start with verb (搜索、修改、创建、读取、分析...)
- Include the key target (file, directory, query)
- If there's an error, mention it briefly

Examples:
- "搜索 auth/ 目录下的文件"
- "修改 UserService 修复空指针"
- "读取 package.json 配置"
- "执行 git status 查看状态"

Output ONLY the summary, nothing else.`;

    const user = `Tool calls:\n${JSON.stringify(truncated, null, 2)}`;

    try {
      const summary = await this.llmCall(system, user);
      const cleaned = summary.trim().split('\n')[0]?.trim() ?? '';
      // 截断到 60 字符
      return cleaned.length > 60 ? cleaned.slice(0, 57) + '...' : cleaned;
    } catch (err) {
      log.debug(`摘要生成失败 (非关键): ${err instanceof Error ? err.message : String(err)}`);
      // 回退到简单摘要
      return tools.map(t => t.toolName).join(', ');
    }
  }

  /**
   * 非阻塞生成摘要（fire-and-forget）
   * 返回 Promise<string>，调用者可选择 await 或忽略
   */
  generateAsync(tools: ToolSummaryRequest[]): Promise<string> {
    return this.generateSummary(tools).catch(err => {
      log.debug(`异步摘要失败: ${err instanceof Error ? err.message : String(err)}`);
      return tools.map(t => t.toolName).join(', ');
    });
  }
}
