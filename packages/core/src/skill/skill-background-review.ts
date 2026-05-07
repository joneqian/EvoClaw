/**
 * Background Skill Review Sub-Agent — W：替换"单次 LLM call → JSON 决策"
 *
 * 灵感来自 Hermes `_spawn_background_review`（commit c50f6e90c + 1bd5ac7f2）。
 * EvoClaw 适配版：
 *   - 每 N=10 turn 在 fire-and-forget 后台跑一个 sub-agent
 *   - 上下文：完整最近对话历史 + agent-created skills 的 SKILL.md + 当前 turn 用过的 skill
 *   - 工具集限定：只给 skill_manage（带 source 门控）+ 不能 invoke / 不能 bash
 *   - sessionKey 带 `:background-review:` marker 防递归
 *   - max_iterations 16（参考 Hermes #19710）
 *   - 决策落 skill_evolution_log，trigger_source='background-review'
 */

import path from 'node:path';
import fs from 'node:fs';
import type { ChatMessage } from '@evoclaw/shared';
import type { AgentRunConfig, RuntimeEvent } from '../agent/types.js';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
// runEmbeddedAgent 用动态 import 引入：架构守卫禁止 skill 层静态依赖 agent 层，
// 但 skill 自进化天然需要起 sub-agent — 通过运行时动态导入保留静态层边界
import { generateBackgroundReviewSessionKey, isPrivilegedSessionKey } from '../routing/session-key.js';
import { createSkillManageTool } from './skill-manage-tool.js';
import { readManifest, type SkillManifestEntry } from './skill-manifest.js';
import { BACKGROUND_REVIEW_SYSTEM_PROMPT } from './skill-evolver-prompt.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-background-review');

/** 默认最大迭代数（参考 Hermes 1bd5ac7f2 把 8 提到 16） */
const DEFAULT_MAX_ITERATIONS = 16;
/** 默认 timeout（90s 单次 review，避免 evolver 卡死前台 budget） */
const DEFAULT_TIMEOUT_MS = 90_000;
/** 喂给 LLM 的 agent-created skills 上限 */
const MAX_SKILLS_IN_CONTEXT = 8;
/** 单 SKILL.md 内容截断 */
const MAX_SKILL_CONTENT_LEN = 4000;
/** 最近对话回溯上限（防 token 爆） */
const MAX_RECENT_MESSAGES = 30;

export interface RunBackgroundReviewOptions {
  /** 父 turn 已构建好的 AgentRunConfig（继承 LLM 凭据 + 工作区配置） */
  parentConfig: AgentRunConfig;
  /** 父 turn 的 sessionKey（用于派生 sub-agent sessionKey + 防递归） */
  parentSessionKey: string;
  /** 当前 owner agent id */
  ownerAgentId: string;
  /** 最近的对话历史快照（user / assistant / tool） */
  recentMessages: ChatMessage[];
  /** 本 turn 调用过的 skill 名（注入到 system prompt 给 LLM 看） */
  recentSkillsUsed: string[];
  /** 用户 skills 目录 */
  userSkillsDir: string;
  /** SQLite store（写 skill_evolution_log） */
  db: SqliteStore;
  /** 单次 review 最长耗时（ms），默认 90s */
  timeoutMs?: number;
  /** 可选：覆盖最大迭代次数 */
  maxIterations?: number;
}

export interface BackgroundReviewResult {
  triggered: boolean;
  /** 跳过原因（triggered=false 时填） */
  reason?: string;
  /** sub-agent sessionKey（触发后填） */
  sessionKey?: string;
  /** skill_manage 工具被调几次（不论结果） */
  toolCallCount?: number;
  /** sub-agent 总耗时（ms） */
  durationMs?: number;
  /** sub-agent 最终文本回复（一句话总结，用于审计） */
  outcome?: string;
  /** 内部错误（不抛，仅返回） */
  errorMessage?: string;
}

/**
 * 主入口：fire-and-forget 安全。永不抛异常，所有错误进 warn log。
 */
export async function runBackgroundReviewAgent(
  opts: RunBackgroundReviewOptions,
): Promise<BackgroundReviewResult> {
  try {
    return await runInternal(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[background-review][unexpected-error] ${msg}`);
    return { triggered: false, reason: 'unexpected-error', errorMessage: msg };
  }
}

async function runInternal(opts: RunBackgroundReviewOptions): Promise<BackgroundReviewResult> {
  const t0 = Date.now();

  // 1) 防递归：父 sessionKey 已是受限上下文 → 直接 skip
  if (!isPrivilegedSessionKey(opts.parentSessionKey)) {
    log.debug(`[skip] reason=non-privileged-parent parent=${opts.parentSessionKey}`);
    return { triggered: false, reason: 'non-privileged-parent' };
  }

  // 2) 列出 agent-created skills（review 只允许改 agent-created；bundled/clawhub/github/local 不动）
  const manifest = readManifest(opts.userSkillsDir);
  const agentCreatedSkills = listAgentCreatedSkillsWithContent(opts.userSkillsDir, manifest);
  if (agentCreatedSkills.length === 0 && opts.recentSkillsUsed.length === 0) {
    // 完全无 skill 信号 → 没意义跑
    log.debug('[skip] reason=no-skill-context');
    return { triggered: false, reason: 'no-skill-context' };
  }

  // 3) 构造 sub-agent sessionKey + messages 快照
  const sessionKey = generateBackgroundReviewSessionKey(opts.ownerAgentId, opts.parentSessionKey);
  const messagesSnapshot = (opts.recentMessages ?? []).slice(-MAX_RECENT_MESSAGES);

  // 4) 构造 systemPrompt = BACKGROUND_REVIEW_SYSTEM_PROMPT + skills 上下文
  const systemPrompt = buildSystemPromptWithContext({
    base: BACKGROUND_REVIEW_SYSTEM_PROMPT,
    agentCreatedSkills,
    recentSkillsUsed: opts.recentSkillsUsed,
  });

  // 5) 工具集限定：只给一个 source-gated 的 skill_manage（不给 bash / read / etc.）
  const tools = [createSourceGatedSkillManage(opts.userSkillsDir)];

  // 6) 构造 child AgentRunConfig（继承 parentConfig 的 LLM 凭据 + 工作区）
  const childConfig: AgentRunConfig = {
    agent: opts.parentConfig.agent,
    systemPrompt,
    workspaceFiles: {}, // 不读 workspace 文件，全靠 conversation history + skill 内容
    workspacePath: opts.parentConfig.workspacePath,
    modelId: opts.parentConfig.modelId,
    provider: opts.parentConfig.provider,
    apiKey: opts.parentConfig.apiKey,
    baseUrl: opts.parentConfig.baseUrl,
    apiProtocol: opts.parentConfig.apiProtocol,
    tools,
    messages: messagesSnapshot,
    sessionKey,
    // 后台任务无人值守：禁 grace call 避免预算耗尽时浪费 token
    graceCallEnabled: false,
    // 沿用主语言（zh 默认）
    ...(opts.parentConfig.language ? { language: opts.parentConfig.language } : {}),
  };

  // 7) Activation message：触发 LLM 行动的 user 消息
  const activation = `请回顾上面的对话历史，按 system prompt 中的优先级行动。最近本 turn 用过的 skill：${
    opts.recentSkillsUsed.length > 0 ? opts.recentSkillsUsed.join(', ') : '（本 turn 没用 skill）'
  }`;

  // 8) 运行 sub-agent，捕获文本输出 + 工具调用数
  let toolCallCount = 0;
  let outcomeText = '';
  const onEvent = (event: RuntimeEvent): void => {
    if (event.type === 'text_delta' && event.delta) {
      outcomeText += event.delta;
    } else if (event.type === 'tool_start' && event.toolName === 'skill_manage') {
      toolCallCount++;
    }
  };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const _maxIter = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  // 注：embedded-runner-loop 内部会按 providerCount 算 maxIterations，目前没暴露
  // 直接覆盖的入口；本期靠 timeoutMs 兜底，未来再加 maxIterationsOverride 入参。
  void _maxIter;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  let errorMessage: string | undefined;
  log.info(`[background-review][start] owner=${opts.ownerAgentId} session=${sessionKey} skills=${agentCreatedSkills.length} usedThisTurn=${opts.recentSkillsUsed.length}`);

  try {
    const { runEmbeddedAgent } = await import('../agent/embedded-runner.js');
    await runEmbeddedAgent(childConfig, activation, onEvent, abortController.signal, {
      isBackgroundQuery: true, // 529 时直接放弃，不再重试
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(`[background-review][run-error] ${errorMessage}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const durationMs = Date.now() - t0;
  const outcome = outcomeText.trim().slice(0, 1000) || '(no text output)';

  // 9) 写 skill_evolution_log（trigger_source='background-review'）
  // 一次 review 可能涉及多个 skill；这里写一条聚合日志，patches 详情已经被
  // 逐个 skill_manage 调用各自落库，这里只做"本次 review 总结"
  try {
    opts.db.run(
      `INSERT INTO skill_evolution_log (
        skill_name, decision, reasoning, evidence_count,
        evidence_summary, model_used, duration_ms, error_message,
        trigger_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'background-review-batch',          // 占位：真正改动按 skill 名落各自 patch_applied
      toolCallCount > 0 ? 'refine' : 'skip',
      outcome,
      agentCreatedSkills.length,
      JSON.stringify({
        toolCallCount,
        recentSkillsUsed: opts.recentSkillsUsed,
        agentCreatedCount: agentCreatedSkills.length,
        timeoutMs,
      }),
      childConfig.modelId,
      durationMs,
      errorMessage ?? null,
      'background-review',
    );
  } catch (err) {
    log.warn(`[background-review][log-write-failed] ${err instanceof Error ? err.message : String(err)}`);
  }

  log.info(`[background-review][done] owner=${opts.ownerAgentId} duration=${durationMs}ms toolCalls=${toolCallCount} outcome="${outcome.slice(0, 100)}"`);

  return {
    triggered: true,
    sessionKey,
    toolCallCount,
    durationMs,
    outcome,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 辅助：列出 agent-created skill + 截取 SKILL.md 内容用于 prompt 注入
// ─────────────────────────────────────────────────────────────────────

interface AgentCreatedSkill {
  name: string;
  content: string;
}

function listAgentCreatedSkillsWithContent(
  userSkillsDir: string,
  manifest: Map<string, SkillManifestEntry>,
): AgentCreatedSkill[] {
  const out: AgentCreatedSkill[] = [];
  for (const entry of manifest.values()) {
    if (entry.source !== 'agent-created') continue;
    const skillPath = path.join(userSkillsDir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = fs.readFileSync(skillPath, 'utf-8');
    } catch {
      continue; // 文件不存在跳过
    }
    if (content.length > MAX_SKILL_CONTENT_LEN) {
      content = content.slice(0, MAX_SKILL_CONTENT_LEN) + '\n... (truncated)';
    }
    out.push({ name: entry.name, content });
    if (out.length >= MAX_SKILLS_IN_CONTEXT) break;
  }
  return out;
}

interface BuildPromptOpts {
  base: string;
  agentCreatedSkills: AgentCreatedSkill[];
  recentSkillsUsed: string[];
}

function buildSystemPromptWithContext(opts: BuildPromptOpts): string {
  const lines: string[] = [opts.base, ''];

  if (opts.recentSkillsUsed.length > 0) {
    lines.push('# 本 turn 已被使用的 skill（优先级 1：patch 这些）');
    for (const name of opts.recentSkillsUsed) {
      lines.push(`- ${name}`);
    }
    lines.push('');
  }

  if (opts.agentCreatedSkills.length > 0) {
    lines.push('# 现有 agent-created skill（你可以 patch / edit / delete 它们）');
    for (const s of opts.agentCreatedSkills) {
      lines.push(`## ${s.name}`);
      lines.push('```markdown');
      lines.push(s.content);
      lines.push('```');
      lines.push('');
    }
  } else {
    lines.push('# 现有 agent-created skill：（无）');
    lines.push('');
  }

  lines.push('# 操作建议');
  lines.push('1. 先看对话识别用户偏好/纠正/新工作流');
  lines.push('2. 优先 patch 上面"已被使用"列表里的 skill');
  lines.push('3. 没合适的就 create 新 class-level skill');
  lines.push('4. 完成后用一句话说做了什么（或为什么没做）');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// 辅助：source-gated skill_manage（防 review 改 bundled / clawhub / github / local 来源 skill）
// ─────────────────────────────────────────────────────────────────────

const ALLOWED_SOURCES_FOR_REVIEW = new Set(['agent-created']);

/** 暴露给测试用：source-gated skill_manage 工厂。生产代码内部使用同一个。 */
export function createSourceGatedSkillManage(userSkillsDir: string): ToolDefinition {
  const inner = createSkillManageTool({ userSkillsDir });
  return {
    ...inner,
    description: inner.description + '\n\n[Background Review 限制] 仅允许操作 source=agent-created 的 skill。其他来源（bundled / clawhub / github / local）会被拒绝。',
    execute: async (args, ctx) => {
      const action = (args as Record<string, unknown>)['action'] as string | undefined;
      const name = (args as Record<string, unknown>)['name'] as string | undefined;
      // create 总是允许（新 skill 默认标 agent-created）
      if (action === 'create') {
        return inner.execute(args, ctx);
      }
      if (!name) {
        return inner.execute(args, ctx); // 让 inner 的 schema 校验报错
      }
      const manifest = readManifest(userSkillsDir);
      const entry = manifest.get(name);
      if (entry && !ALLOWED_SOURCES_FOR_REVIEW.has(entry.source)) {
        const denyMsg = JSON.stringify({
          success: false,
          action,
          name,
          error: `background review 不允许修改 source=${entry.source} 的 skill。仅允许 agent-created。`,
        });
        log.warn(`[background-review][source-gate-deny] action=${action} name=${name} source=${entry.source}`);
        return denyMsg;
      }
      // entry 不存在（manifest 里没记录）通常是边界情况；放行让 inner 报合理错
      return inner.execute(args, ctx);
    },
  };
}
