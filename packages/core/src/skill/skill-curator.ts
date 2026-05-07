/**
 * Skill Curator Sub-Agent — 跨 session 的 skill 库治理
 *
 * 灵感来自 Hermes `run_curator_review`（agent/curator.py）。
 * 与 background-review 区别：
 *   - background-review：每 N=10 turn，单 session 学习
 *   - curator：每 N 天（默认 7d），跨 session 治理 — umbrella consolidation
 *
 * 流程：
 *   1. applyAutomaticTransitions（纯逻辑，无 LLM）— 30/90 阈值状态机
 *   2. 列 agent-created skills 喂给 sub-agent
 *   3. sub-agent 用 CURATOR_REVIEW_SYSTEM_PROMPT 跑 LLM consolidation
 *   4. 解析 YAML 块 → 分类 consolidations / prunings
 *   5. 落 skill_evolution_log（trigger_source='curator-consolidation' / 'curator-prune'）
 *   6. 更新 .curator_state.json（lastRunAt / runCount / summary）
 *
 * 参考实现细节：
 *   - createSourceGatedSkillManage（已存在，复用）：拒绝改 bundled/clawhub/github/local
 *   - generateCuratorSessionKey: agent:curator:local:curator:<runId> marker 防递归
 *   - 工具集：仅 source-gated skill_manage（无 invoke_skill / 无 bash）
 *   - sub-agent 用 isBackgroundQuery=true 防 529 重试
 */

import path from 'node:path';
import fs from 'node:fs';
import type { AgentRunConfig, RuntimeEvent } from '../agent/types.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { generateCuratorSessionKey } from '../routing/session-key.js';
import { readManifest } from './skill-manifest.js';
import { CURATOR_REVIEW_SYSTEM_PROMPT } from './skill-evolver-prompt.js';
import { createSourceGatedSkillManage } from './skill-background-review.js';
import { applyAutomaticTransitions, type ApplyTransitionsResult } from './skill-curator-state-machine.js';
import { updateCuratorState } from './skill-curator-state.js';
import { getEntry as getLifecycleEntry } from './skill-curator-lifecycle.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-curator');

/** 默认 max_iterations（参考 W：16，Hermes 同） */
const DEFAULT_MAX_ITERATIONS = 16;
/** 默认 timeout（curator 是大批量，留 3min） */
const DEFAULT_TIMEOUT_MS = 180_000;
/** 候选 skill 上限（防 token 量爆） */
const MAX_CANDIDATES = 30;
/** 单 SKILL.md 上下文截断 */
const MAX_SKILL_CONTENT_LEN = 3000;

export interface RunCuratorReviewOptions {
  /** 父 turn 已构建好的 AgentRunConfig（继承 LLM 凭据；通常来自 SkillEvolverScheduler 的 holder） */
  parentConfig: AgentRunConfig;
  /** 用户 skills 目录 */
  userSkillsDir: string;
  /** SQLite store（写 evolution_log + 查 skill_usage MAX(invoked_at)） */
  db: SqliteStore;
  /** dry-run：跳过自动转换 + LLM 仅报告不调 skill_manage */
  dryRun?: boolean;
  /** 自定义阈值 */
  staleDays?: number;
  archivedDays?: number;
  /** 单次 timeout */
  timeoutMs?: number;
}

export interface CuratorReviewResult {
  /** 是否实际跑了 LLM review */
  llmRan: boolean;
  /** Skip 时的原因 */
  reason?: string;
  /** 自动状态转换结果 */
  transitions: ApplyTransitionsResult;
  /** sub-agent sessionKey */
  sessionKey?: string;
  /** sub-agent 输出文本 */
  outcome?: string;
  /** YAML 解析出的 consolidations */
  consolidations?: ConsolidationEntry[];
  /** YAML 解析出的 prunings */
  prunings?: PruningEntry[];
  /** sub-agent 总耗时 ms */
  durationMs?: number;
  /** sub-agent skill_manage 调用次数 */
  toolCallCount?: number;
  /** 错误信息（不抛） */
  errorMessage?: string;
}

export interface ConsolidationEntry {
  from: string;
  into: string;
  reason: string;
}

export interface PruningEntry {
  name: string;
  reason: string;
}

/**
 * 主入口：fire-and-forget 安全。永不抛异常；所有错误进 warn log + 返回 errorMessage。
 */
export async function runCuratorReview(
  opts: RunCuratorReviewOptions,
): Promise<CuratorReviewResult> {
  try {
    return await runInternal(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[curator][unexpected-error] ${msg}`);
    return {
      llmRan: false,
      reason: 'unexpected-error',
      transitions: { checked: 0, markedStale: 0, reactivated: 0, archived: 0, skippedPinned: 0, errors: [] },
      errorMessage: msg,
    };
  }
}

async function runInternal(opts: RunCuratorReviewOptions): Promise<CuratorReviewResult> {
  const t0 = Date.now();
  log.info(`[curator][start] dryRun=${opts.dryRun ?? false}`);

  // 1) 自动转换（dry-run 时跳过）
  let transitions: ApplyTransitionsResult;
  if (opts.dryRun) {
    transitions = { checked: 0, markedStale: 0, reactivated: 0, archived: 0, skippedPinned: 0, errors: [] };
    log.info('[curator][transitions][skipped] dry-run');
  } else {
    transitions = applyAutomaticTransitions({
      db: opts.db,
      userSkillsDir: opts.userSkillsDir,
      ...(opts.staleDays !== undefined ? { staleDays: opts.staleDays } : {}),
      ...(opts.archivedDays !== undefined ? { archivedDays: opts.archivedDays } : {}),
    });
  }

  // 2) 列出剩余的 active/stale agent-created skill 喂给 LLM
  const candidates = listCandidatesForReview(opts.userSkillsDir);
  if (candidates.length < 2) {
    // 少于 2 个候选无 consolidation 价值
    const reason = candidates.length === 0 ? 'no-agent-created-skills' : 'only-one-candidate';
    log.info(`[curator][skip-llm] ${reason} (count=${candidates.length})`);
    persistRunSummary(transitions, /* llmOutcome */ null, t0, /* errorMessage */ null);
    return {
      llmRan: false,
      reason,
      transitions,
    };
  }

  // 3) 起 sub-agent
  const sessionKey = generateCuratorSessionKey();
  const tools = [createSourceGatedSkillManage(opts.userSkillsDir)];
  const systemPrompt = buildSystemPromptWithCandidates(candidates, opts.dryRun ?? false);

  const childConfig: AgentRunConfig = {
    agent: opts.parentConfig.agent,
    systemPrompt,
    workspaceFiles: {},
    workspacePath: opts.parentConfig.workspacePath,
    modelId: opts.parentConfig.modelId,
    provider: opts.parentConfig.provider,
    apiKey: opts.parentConfig.apiKey,
    baseUrl: opts.parentConfig.baseUrl,
    apiProtocol: opts.parentConfig.apiProtocol,
    tools,
    messages: [],
    sessionKey,
    graceCallEnabled: false,
    maxTurns: DEFAULT_MAX_ITERATIONS,
    ...(opts.parentConfig.language ? { language: opts.parentConfig.language } : {}),
  };

  const activation = opts.dryRun
    ? '请回顾候选 skill 列表，**不要调任何 skill_manage 工具**，只输出人话总结 + YAML 块（标记你打算 consolidate / prune 哪些，不实际操作）。'
    : '请回顾下方候选 skill 列表，按 system prompt 的优先级 + 工作流执行 consolidation。完成后输出人话总结 + YAML 块。';

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
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  let errorMessage: string | undefined;
  try {
    const { runEmbeddedAgent } = await import('../agent/embedded-runner.js');
    await runEmbeddedAgent(childConfig, activation, onEvent, abortController.signal, {
      isBackgroundQuery: true,
    });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(`[curator][run-error] ${errorMessage}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  const durationMs = Date.now() - t0;
  const outcome = outcomeText.trim().slice(0, 4000);

  // 4) 解析 YAML 块
  const parsed = parseCuratorYamlBlock(outcome);
  log.info(`[curator][done] duration=${durationMs}ms toolCalls=${toolCallCount} consolidations=${parsed.consolidations.length} prunings=${parsed.prunings.length}`);

  // 5) 写 evolution_log（每条 consolidation/pruning 一行 + 一条聚合总结行）
  writeEvolutionLogEntries({
    db: opts.db,
    transitions,
    consolidations: parsed.consolidations,
    prunings: parsed.prunings,
    outcome,
    durationMs,
    toolCallCount,
    modelId: childConfig.modelId,
    errorMessage,
  });

  // 6) 更新全局调度状态
  persistRunSummary(transitions, parsed, t0, errorMessage ?? null);

  return {
    llmRan: true,
    transitions,
    sessionKey,
    outcome,
    consolidations: parsed.consolidations,
    prunings: parsed.prunings,
    durationMs,
    toolCallCount,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface CandidateSkill {
  name: string;
  content: string;
  createdAt: string;
  state: string;
  pinned: boolean;
}

function listCandidatesForReview(userSkillsDir: string): CandidateSkill[] {
  const manifest = readManifest(userSkillsDir);
  const out: CandidateSkill[] = [];
  for (const entry of manifest.values()) {
    if (entry.source !== 'agent-created') continue;
    const lifecycle = getLifecycleEntry(entry.name, userSkillsDir);
    if (lifecycle.state === 'archived' || lifecycle.pinned) continue;

    const skillPath = path.join(userSkillsDir, entry.name, 'SKILL.md');
    let content: string;
    try {
      content = fs.readFileSync(skillPath, 'utf-8');
    } catch {
      continue;
    }
    if (content.length > MAX_SKILL_CONTENT_LEN) {
      content = content.slice(0, MAX_SKILL_CONTENT_LEN) + '\n... (truncated)';
    }
    out.push({
      name: entry.name,
      content,
      createdAt: entry.createdAt,
      state: lifecycle.state,
      pinned: lifecycle.pinned,
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function buildSystemPromptWithCandidates(candidates: CandidateSkill[], dryRun: boolean): string {
  const lines: string[] = [CURATOR_REVIEW_SYSTEM_PROMPT, ''];
  if (dryRun) {
    lines.push('# 当前模式：DRY-RUN');
    lines.push('**禁止调用 skill_manage 工具**。仅输出 YAML 块描述你**打算**做的合并 / 归档。');
    lines.push('');
  }
  lines.push(`# 候选 skill 列表（共 ${candidates.length} 个，仅 agent-created 来源）`);
  lines.push('');
  for (const c of candidates) {
    lines.push(`## ${c.name} (state=${c.state}, createdAt=${c.createdAt})`);
    lines.push('```markdown');
    lines.push(c.content);
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

interface ParsedCuratorOutput {
  consolidations: ConsolidationEntry[];
  prunings: PruningEntry[];
}

/**
 * 解析 LLM 输出末尾的 \`\`\`yaml\` 块（容忍单个，多个时取最后一个）。
 * 失败 → 返回空数组（不抛）。
 */
export function parseCuratorYamlBlock(text: string): ParsedCuratorOutput {
  const empty: ParsedCuratorOutput = { consolidations: [], prunings: [] };
  if (!text) return empty;

  // 提取最后一个 ```yaml...``` 块
  const re = /```ya?ml\s*\n([\s\S]*?)\n```/gi;
  let lastBody: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    lastBody = m[1] ?? null;
  }
  if (!lastBody) return empty;

  // 极简手写 YAML 解析（避免 yaml 包依赖）：只支持本期需要的两段结构
  const out: ParsedCuratorOutput = { consolidations: [], prunings: [] };
  const lines = lastBody.split('\n');
  let section: 'consolidations' | 'prunings' | null = null;
  let current: Record<string, string> = {};
  let inEntry = false;

  function flush(): void {
    if (!inEntry || !section) return;
    if (section === 'consolidations') {
      const from = (current['from'] ?? '').trim();
      const into = (current['into'] ?? '').trim();
      const reason = (current['reason'] ?? '').trim();
      if (from && into) out.consolidations.push({ from, into, reason });
    } else {
      const name = (current['name'] ?? '').trim();
      const reason = (current['reason'] ?? '').trim();
      if (name) out.prunings.push({ name, reason });
    }
    current = {};
    inEntry = false;
  }

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  '); // 简化处理
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^consolidations\s*:/.test(trimmed)) {
      flush();
      section = 'consolidations';
      // 同行可能 = []
      if (/:\s*\[\s*\]$/.test(trimmed)) section = null;
      continue;
    }
    if (/^prunings\s*:/.test(trimmed)) {
      flush();
      section = 'prunings';
      if (/:\s*\[\s*\]$/.test(trimmed)) section = null;
      continue;
    }

    if (section && /^- /.test(trimmed)) {
      flush();
      inEntry = true;
      // 第一项也可能是 key:value
      const after = trimmed.slice(2);
      const kv = parseKv(after);
      if (kv) current[kv.k] = kv.v;
      continue;
    }
    if (section && inEntry) {
      const kv = parseKv(trimmed);
      if (kv) current[kv.k] = kv.v;
    }
  }
  flush();

  return out;
}

function parseKv(s: string): { k: string; v: string } | null {
  const m = s.match(/^([a-zA-Z_]\w*)\s*:\s*(.*)$/);
  if (!m) return null;
  let v = m[2]!.trim();
  // 去掉外层引号
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return { k: m[1]!, v };
}

interface WriteLogOptions {
  db: SqliteStore;
  transitions: ApplyTransitionsResult;
  consolidations: ConsolidationEntry[];
  prunings: PruningEntry[];
  outcome: string;
  durationMs: number;
  toolCallCount: number;
  modelId: string;
  errorMessage?: string;
}

function writeEvolutionLogEntries(opts: WriteLogOptions): void {
  // 一条聚合行
  try {
    opts.db.run(
      `INSERT INTO skill_evolution_log (
        skill_name, decision, reasoning, evidence_count,
        evidence_summary, model_used, duration_ms, error_message,
        trigger_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'curator-batch',
      opts.consolidations.length > 0 || opts.prunings.length > 0 ? 'refine' : 'skip',
      opts.outcome.slice(0, 2000),
      opts.consolidations.length + opts.prunings.length,
      JSON.stringify({
        transitions: opts.transitions,
        consolidationsCount: opts.consolidations.length,
        pruningsCount: opts.prunings.length,
        toolCallCount: opts.toolCallCount,
      }),
      opts.modelId,
      opts.durationMs,
      opts.errorMessage ?? null,
      'curator-run',
    );
  } catch (err) {
    log.warn(`[curator][log-write-failed] aggregate: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 每条 consolidation 一行（trigger_source='curator-consolidation'）
  for (const c of opts.consolidations) {
    try {
      opts.db.run(
        `INSERT INTO skill_evolution_log (
          skill_name, decision, reasoning, evidence_count,
          evidence_summary, model_used, duration_ms, trigger_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        c.from,
        'consolidate-into',
        c.reason || `合并到 ${c.into}`,
        1,
        JSON.stringify({ into: c.into }),
        opts.modelId,
        opts.durationMs,
        'curator-consolidation',
      );
    } catch (err) {
      log.warn(`[curator][log-write-failed] consolidation ${c.from}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 每条 pruning 一行（trigger_source='curator-prune'）
  for (const p of opts.prunings) {
    try {
      opts.db.run(
        `INSERT INTO skill_evolution_log (
          skill_name, decision, reasoning, evidence_count,
          model_used, duration_ms, trigger_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        p.name,
        'archive',
        p.reason || '无吸收目标，归档',
        1,
        opts.modelId,
        opts.durationMs,
        'curator-prune',
      );
    } catch (err) {
      log.warn(`[curator][log-write-failed] pruning ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function persistRunSummary(
  transitions: ApplyTransitionsResult,
  parsed: ParsedCuratorOutput | null,
  startTs: number,
  errorMessage: string | null,
): void {
  const summaryParts: string[] = [];
  if (transitions.checked > 0) {
    summaryParts.push(`扫描 ${transitions.checked}`);
    if (transitions.markedStale > 0) summaryParts.push(`stale ${transitions.markedStale}`);
    if (transitions.archived > 0) summaryParts.push(`archived ${transitions.archived}`);
    if (transitions.reactivated > 0) summaryParts.push(`reactivate ${transitions.reactivated}`);
  }
  if (parsed) {
    if (parsed.consolidations.length > 0) summaryParts.push(`merge ${parsed.consolidations.length}`);
    if (parsed.prunings.length > 0) summaryParts.push(`prune ${parsed.prunings.length}`);
  }
  if (errorMessage) summaryParts.push(`error: ${errorMessage.slice(0, 100)}`);

  const summary = summaryParts.length > 0 ? summaryParts.join(' / ') : '无变更';

  try {
    const cur = updateCuratorState({
      lastRunAt: new Date().toISOString(),
      lastRunDurationMs: Date.now() - startTs,
      lastRunSummary: summary,
    });
    cur.runCount += 1;
    updateCuratorState({ runCount: cur.runCount });
  } catch (err) {
    log.warn(`[curator][state-persist-failed] ${err instanceof Error ? err.message : String(err)}`);
  }
}
