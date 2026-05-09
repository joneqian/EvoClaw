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
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { findActiveTest, assignBucket, recordOutcome, type AbVariant } from './skill-ab-store.js';
import { readVariantFromCache } from './skill-ab-cache.js';

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
  /** M7-Tier3 PR-T3-1a: SqliteStore — 查 active A-B 测试 + 记录 outcome；未注入则跳过 A-B */
  db?: SqliteStore;
  /** M7-Tier3 PR-T3-1a: 用户 skills 目录 — 读 .ab-cache/ 中的 A 版本；未注入则跳过 A-B */
  userSkillsDir?: string;
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

      // M7-Tier3 PR-T3-1a: A-B 桶位决定 — 命中 active 测试时 variant=A 加载 cache 内容
      let abContext: { abTestId: number; variant: AbVariant } | null = null;
      let skillMdContent: string | null = null;
      if (options?.db && options?.userSkillsDir) {
        const test = findActiveTest(options.db, skillName);
        if (test) {
          // M7-Tier3 PR-T3-2b: canary 测试用偏置桶位（is_canary=1 + canary_ratio_b=0.1 默认 90/10）
          const ratioB = test.isCanary === 1 && test.canaryRatioB !== null && test.canaryRatioB !== undefined ? test.canaryRatioB : undefined;
          const variant = assignBucket(options.sessionKey, skillName, test.id, ratioB);
          abContext = { abTestId: test.id, variant };
          if (variant === 'A') {
            // 从 cache 读 A 版本；cache miss 兜底到当前 SKILL.md（实际偏 B，会被评估器识别为偏置）
            skillMdContent = readVariantFromCache(options.userSkillsDir, skillName, test.variantAHash);
          }
          // variant=B 走默认路径（与下方 fallback 一致）
        }
      }
      // 默认路径：从 skillPaths 读当前 SKILL.md（B 版本 / 无 A-B 时的常规情况 / cache miss 兜底）
      if (skillMdContent === null) {
        skillMdContent = findSkillContent(skillName, skillPaths);
      }

      // A-B outcome 记录 helper（包装 emit；只在 abContext 存在时落 outcome）
      const recordAbOutcome = (success: boolean, durationMs?: number, toolCallsCount?: number): void => {
        if (!abContext || !options?.db) return;
        try {
          recordOutcome(options.db, {
            abTestId: abContext.abTestId,
            variant: abContext.variant,
            ...(options.sessionKey ? { sessionKey: options.sessionKey } : {}),
            ...(options.agentId ? { agentId: options.agentId } : {}),
            success,
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(toolCallsCount !== undefined ? { toolCallsCount } : {}),
          });
        } catch {
          // A-B telemetry 永不阻塞主流程
        }
      };

      if (!skillMdContent) {
        emit({ success: false, executionMode: 'inline', errorSummary: `skill not found: ${skillName}` });
        recordAbOutcome(false, Date.now() - startTime);
        return { content: `未找到 Skill: ${skillName}。请检查名称是否正确，或使用 ToolSearch 搜索可用 Skill。`, isError: true };
      }

      const parsed = parseSkillMd(skillMdContent);
      if (!parsed) {
        emit({ success: false, executionMode: 'inline', errorSummary: `invalid SKILL.md: ${skillName}` });
        recordAbOutcome(false, Date.now() - startTime);
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
          recordAbOutcome(!result.isError, Date.now() - startTime);
          return { content: result.content, isError: result.isError };
        } catch (err) {
          emit({
            success: false,
            executionMode: 'fork',
            errorSummary: sanitizeErrorSummary(String(err)),
          });
          recordAbOutcome(false, Date.now() - startTime);
          throw err;
        }
      }

      // Inline 模式（默认）— Skill 指令注入后不做进一步执行，视为成功
      const header = `# Skill: ${parsed.metadata.name}\n> ${parsed.metadata.description}\n\n`;
      emit({ success: true, executionMode: 'inline' });
      recordAbOutcome(true, Date.now() - startTime);
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
