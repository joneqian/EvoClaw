/**
 * SkillTool — 模型主动调用 Skill 的 KernelTool
 *
 * 支持三种执行模式:
 * 1. inline（默认）: 加载 SKILL.md 指令注入当前轮次上下文
 * 2. fork: 在独立子代理中执行，仅返回结果摘要
 * 3. MCP prompt: 通过 MCP SDK getPrompt() 获取内容
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSkillMd } from './skill-parser.js';
import { substituteArguments } from './skill-arguments.js';
import { forkExecuteSkill, type ForkExecuteParams } from './skill-fork-executor.js';
import type { SkillTelemetrySink, SkillUsageRecord } from './skill-usage-store.js';
import { sanitizeErrorSummary } from './skill-usage-store.js';

// 避免跨层导入 agent/kernel/types.ts — 使用兼容接口
interface ToolLike {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly searchHint?: string;
  call(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }>;
  isReadOnly(): boolean;
  isConcurrencySafe(): boolean;
}

/** MCP Prompt 执行函数类型 */
export type McpPromptExecutorFn = (serverName: string, promptName: string, args?: Record<string, string>) => Promise<string>;

/** 模型解析结果（从 provider/modelId 解析） */
export interface ResolvedModelConfig {
  protocol: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  contextWindow: number;
}

/** 模型解析函数：将 "provider/modelId" 解析为 API 配置，未配置时返回 undefined */
export type ModelResolverFn = (modelRef: string) => ResolvedModelConfig | undefined;

/** Fork 模式配置 */
export interface ForkConfig {
  enabled: boolean;
  apiConfig: ForkExecuteParams['apiConfig'];
}

/** SkillTool 选项 */
export interface SkillToolOptions {
  /** Fork 模式配置 */
  forkConfig?: ForkConfig;
  /** MCP Prompt 执行器 */
  mcpPromptExecutor?: McpPromptExecutorFn;
  /** 模型解析器（将 skill 指定的 model 字段解析为 API 配置） */
  modelResolver?: ModelResolverFn;
  /** M7 Phase 2: 调用 telemetry 接收器（失败静默，不阻塞执行） */
  telemetry?: SkillTelemetrySink;
  /** M7 Phase 2: 当前 Agent ID（telemetry 需要） */
  agentId?: string;
  /** M7 Phase 2: 当前 sessionKey（telemetry 需要） */
  sessionKey?: string;
}

/**
 * 创建 SkillTool
 *
 * @param skillPaths Skill 搜索路径列表
 * @param options 可选配置（fork 模式、MCP prompt 执行器）
 */
export function createSkillTool(skillPaths: string[], options?: SkillToolOptions): ToolLike {
  return {
    name: 'invoke_skill',
    description: `执行一个已安装的 Skill（技能）。

当用户请求的任务与 <available_skills> 中列出的技能匹配时，使用此工具加载该技能的完整指令，然后按指令执行。
Skill 提供专业的多步工作流，比直接使用基础工具更可靠、更全面。

使用方式:
- invoke_skill({ skill: "技能名称" }) — 加载技能指令
- invoke_skill({ skill: "技能名称", args: "参数" }) — 加载并传入参数
- invoke_skill({ skill: "技能名称", mode: "fork" }) — 在独立上下文中执行（适合复杂技能）

标记为 <mode>fork</mode> 的技能会自动使用 fork 模式执行。

示例:
- 用户要搜索信息 → invoke_skill({ skill: "web-search", args: "搜索内容" })
- 用户要生成文档 → invoke_skill({ skill: "Word / DOCX", args: "文档要求" })
- 用户要分析数据 → invoke_skill({ skill: "Excel / XLSX", args: "数据需求" })

如果 <available_skills> 中没有匹配的技能，直接使用基础工具即可。`,
    searchHint: 'skill invoke command prompt workflow',
    inputSchema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Skill 名称（从 <available_skills> 目录中选择）',
        },
        args: {
          type: 'string',
          description: '传递给 Skill 的参数（可选）',
        },
        mode: {
          type: 'string',
          enum: ['inline', 'fork'],
          description: '执行模式（可选，覆盖技能默认模式）',
        },
      },
      required: ['skill'],
    },

    async call(input: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
      const skillName = String(input.skill ?? '').trim();
      const args = String(input.args ?? '').trim();
      const modeOverride = input.mode as string | undefined;
      const startTime = Date.now();

      // Telemetry helper — 失败静默，不阻塞 Agent
      const emit = (
        partial: Partial<SkillUsageRecord> & Pick<SkillUsageRecord, 'success' | 'executionMode'>,
      ): void => {
        if (!options?.telemetry || !options.agentId || !options.sessionKey) return;
        try {
          options.telemetry.record({
            skillName: skillName || '<unknown>',
            agentId: options.agentId,
            sessionKey: options.sessionKey,
            triggerType: 'invoke_skill',
            durationMs: Date.now() - startTime,
            ...partial,
          });
        } catch {
          // 永不阻塞
        }
      };

      if (!skillName) {
        return { content: '请指定 Skill 名称', isError: true };
      }

      // MCP Prompt 路由: mcp:{serverName}:{promptName}
      if (skillName.startsWith('mcp:') && options?.mcpPromptExecutor) {
        try {
          const result = await handleMcpPrompt(skillName, args, options.mcpPromptExecutor);
          emit({ success: !result.isError, executionMode: 'inline' });
          return result;
        } catch (err) {
          emit({
            success: false,
            executionMode: 'inline',
            errorSummary: sanitizeErrorSummary(String(err)),
          });
          throw err;
        }
      }

      // 在所有 skill 路径中搜索匹配的 SKILL.md
      const skillMdContent = findSkillContent(skillName, skillPaths);
      if (!skillMdContent) {
        emit({ success: false, executionMode: 'inline', errorSummary: `skill not found: ${skillName}` });
        return { content: `未找到 Skill: ${skillName}。请检查名称是否正确，或使用 ToolSearch 搜索可用 Skill。`, isError: true };
      }

      const parsed = parseSkillMd(skillMdContent);
      if (!parsed) {
        emit({ success: false, executionMode: 'inline', errorSummary: `invalid SKILL.md: ${skillName}` });
        return { content: `Skill ${skillName} 的 SKILL.md 格式无效`, isError: true };
      }

      // 参数替换（传入命名参数列表以支持位置→命名映射）
      let body = parsed.body;
      if (args) {
        body = substituteArguments(body, args, parsed.metadata.arguments);
      }

      // 判断执行模式: 显式覆盖 > SKILL.md 声明 > 默认 inline
      const effectiveMode = modeOverride ?? parsed.metadata.executionMode ?? 'inline';

      // Fork 模式
      if (effectiveMode === 'fork' && options?.forkConfig?.enabled) {
        try {
          const result = await handleForkExecution(
            skillName, body, parsed.metadata.description, args,
            options.forkConfig, parsed.metadata.model, options.modelResolver,
          );
          emit({
            success: !result.isError,
            executionMode: 'fork',
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            errorSummary: result.isError ? sanitizeErrorSummary(result.content ?? '') : undefined,
          });
          return { content: result.content, isError: result.isError };
        } catch (err) {
          emit({
            success: false,
            executionMode: 'fork',
            errorSummary: sanitizeErrorSummary(String(err)),
          });
          throw err;
        }
      }

      // Inline 模式（默认）— Skill 指令注入后不做进一步执行，视为成功
      const header = `# Skill: ${parsed.metadata.name}\n> ${parsed.metadata.description}\n\n`;
      emit({ success: true, executionMode: 'inline' });
      return { content: header + body };
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

/** 处理 MCP Prompt 调用 */
async function handleMcpPrompt(
  skillName: string,
  args: string,
  executor: McpPromptExecutorFn,
): Promise<{ content: string; isError?: boolean }> {
  // 解析 mcp:{serverName}:{promptName}
  const parts = skillName.split(':');
  if (parts.length < 3) {
    return { content: `MCP Prompt 名称格式无效: ${skillName}（应为 mcp:serverName:promptName）`, isError: true };
  }
  const serverName = parts[1];
  const promptName = parts.slice(2).join(':'); // promptName 可能含冒号

  const argsMap = args ? { input: args } : undefined;
  const content = await executor(serverName, promptName, argsMap);
  return { content: `# MCP Prompt: ${promptName}\n> from ${serverName}\n\n${content}` };
}

/** 处理 Fork 执行 */
async function handleForkExecution(
  skillName: string,
  body: string,
  description: string,
  args: string,
  forkConfig: ForkConfig,
  skillModel?: string,
  modelResolver?: ModelResolverFn,
): Promise<{ content: string; isError?: boolean; inputTokens?: number; outputTokens?: number }> {
  // 尝试使用 skill 指定的模型，未配置时降级为当前默认模型
  let apiConfig = forkConfig.apiConfig;
  if (skillModel && modelResolver) {
    const resolved = modelResolver(skillModel);
    if (resolved) {
      apiConfig = resolved;
    }
    // 未解析到 → 静默降级，使用默认模型
  }

  const result = await forkExecuteSkill({
    skillName,
    skillBody: body,
    skillDescription: description,
    args: args || undefined,
    apiConfig,
  });

  const header = `# Skill Fork 结果: ${skillName}\n> token 消耗: ${result.tokenUsage.input} in / ${result.tokenUsage.output} out\n\n`;
  return {
    content: header + result.result,
    isError: result.isError,
    inputTokens: result.tokenUsage.input,
    outputTokens: result.tokenUsage.output,
  };
}

/**
 * 在 skill 路径中搜索指定名称的 SKILL.md
 */
function findSkillContent(skillName: string, skillPaths: string[]): string | null {
  const normalizedName = skillName.toLowerCase();

  for (const basePath of skillPaths) {
    if (!fs.existsSync(basePath)) continue;

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // 目录名匹配（不区分大小写）
        if (entry.name.toLowerCase() === normalizedName) {
          const skillMdPath = path.join(basePath, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            return fs.readFileSync(skillMdPath, 'utf-8');
          }
        }
      }
    } catch {
      // 目录不可读，跳过
    }
  }

  return null;
}
