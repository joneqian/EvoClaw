/**
 * Skill Evolver — M7 Phase 3
 *
 * runEvolutionCycle:
 *   1. 找出候选 Skill（成功率 < threshold 且 invocations ≥ 5）
 *   2. 对每个候选：
 *      - 读 SKILL.md + manifest，用户手改过 → skip
 *      - 聚合证据（摘要 + 最近 usage + 反馈）
 *      - 证据不足 → skip
 *      - 调用辅助 LLM → 解析 JSON 决策
 *      - 执行决策（refine = 严格子串替换；create = 走 skill_manage 完整流程）
 *      - 写 skill_evolution_log
 *   3. 连续 3 次 LLM 失败 → 熔断，当次 cycle 终止
 *
 * 安全：
 * - 所有写入前 scanSkillMd（FAIL-CLOSED on high）
 * - patch 必须是当前 SKILL.md 的精确子串，否则 skip
 * - 永不触发 invoke_skill 递归（Cron context 不注入该工具）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { SkillUsageStore } from './skill-usage-store.js';
import { gatherEvidence, shouldEvolve, type EvolutionEvidence } from './skill-evidence-gatherer.js';
import { EVOLVER_SYSTEM_PROMPT, parseEvolverResponse, renderEvidenceAsPrompt, type EvolverDecision } from './skill-evolver-prompt.js';
import { scanSkillMd, SKILL_NAME_REGEX } from './skill-content-scanner.js';
import { createSkillInternal, editSkillInternal } from './skill-manage-tool.js';
import { computeSkillHash, upsertManifestEntry } from './skill-manifest.js';

const log = createLogger('skill-evolver');

/** 辅助 LLM 调用签名（与 summarizer / web-fetch 一致） */
export type LLMCallFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface SkillEvolverConfig {
  enabled: boolean;
  cronSchedule: string;
  minEvidenceCount: number;
  successRateThreshold: number;
  maxCandidatesPerRun: number;
  model?: string;
}

export interface RunEvolutionCycleOptions {
  db: SqliteStore;
  userSkillsDir: string;
  config: SkillEvolverConfig;
  llmCall: LLMCallFn;
  /** 候选 Skill 回看天数（默认 30） */
  lookbackDays?: number;
  /** 每个 Skill 最少调用多少次才算候选（默认 5） */
  minInvocationsForCandidate?: number;
}

export interface EvolutionCycleResult {
  candidatesFound: number;
  refined: number;
  created: number;
  skipped: number;
  failed: number;
}

/** 一次完整的进化 cycle。永不抛异常，失败项记日志。 */
export async function runEvolutionCycle(opts: RunEvolutionCycleOptions): Promise<EvolutionCycleResult> {
  const {
    db, userSkillsDir, config, llmCall,
    lookbackDays = 30, minInvocationsForCandidate = 5,
  } = opts;

  const result: EvolutionCycleResult = {
    candidatesFound: 0, refined: 0, created: 0, skipped: 0, failed: 0,
  };

  if (!config.enabled) {
    log.debug('skillEvolver disabled, skipping cycle');
    return result;
  }

  const store = new SkillUsageStore(db);

  // 1. 查候选
  const candidates = findCandidates(db, {
    lookbackDays,
    minInvocationsForCandidate,
    successRateThreshold: config.successRateThreshold,
    limit: config.maxCandidatesPerRun,
  });
  result.candidatesFound = candidates.length;
  log.info(`evolution cycle start: ${candidates.length} candidates`);

  // 2. 熔断器
  let llmConsecutiveFailures = 0;
  const BREAKER_THRESHOLD = 3;

  for (const skillName of candidates) {
    if (llmConsecutiveFailures >= BREAKER_THRESHOLD) {
      log.warn(`LLM 熔断器触发（连续 ${BREAKER_THRESHOLD} 次失败），终止当次 cycle`);
      break;
    }

    const cycleStart = Date.now();
    const evidence = gatherEvidence({ skillName, store, userSkillsDir });

    const gate = shouldEvolve(evidence, {
      minEvidenceCount: config.minEvidenceCount,
      successRateThreshold: config.successRateThreshold,
    });
    if (!gate.proceed) {
      logDecision(db, {
        skillName, decision: 'skip', reasoning: gate.reason,
        evidence, previousHash: evidence.currentHash, newHash: null,
        model: config.model ?? null, durationMs: Date.now() - cycleStart,
      });
      result.skipped++;
      continue;
    }

    // 3. 调 LLM
    let decision: EvolverDecision;
    try {
      const raw = await llmCall(EVOLVER_SYSTEM_PROMPT, renderEvidenceAsPrompt(evidence));
      decision = parseEvolverResponse(raw);
      llmConsecutiveFailures = 0;
    } catch (err) {
      llmConsecutiveFailures++;
      log.warn(`evolver LLM 调用失败 (${skillName})`, { err: String(err) });
      logDecision(db, {
        skillName, decision: 'skip', reasoning: `LLM error: ${String(err).slice(0, 200)}`,
        evidence, previousHash: evidence.currentHash, newHash: null,
        model: config.model ?? null, durationMs: Date.now() - cycleStart,
        errorMessage: String(err).slice(0, 500),
      });
      result.failed++;
      continue;
    }

    // 4. 执行决策
    const outcome = await executeDecision({
      decision, evidence, userSkillsDir,
    });

    logDecision(db, {
      skillName: outcome.targetSkillName ?? skillName,
      decision: decision.decision,
      reasoning: decision.reasoning,
      evidence,
      previousHash: evidence.currentHash,
      newHash: outcome.newHash,
      patchesApplied: outcome.patchesApplied,
      model: config.model ?? null,
      durationMs: Date.now() - cycleStart,
      errorMessage: outcome.error,
      previousContent: outcome.previousContent ?? null,
      newContent: outcome.newContent ?? null,
    });

    if (outcome.error) {
      result.failed++;
    } else if (decision.decision === 'refine') {
      result.refined++;
    } else if (decision.decision === 'create') {
      result.created++;
    } else {
      result.skipped++;
    }
  }

  log.info(`evolution cycle done`, { ...result });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Candidates
// ═══════════════════════════════════════════════════════════════════════════

interface FindCandidatesOpts {
  lookbackDays: number;
  minInvocationsForCandidate: number;
  successRateThreshold: number;
  limit: number;
}

function findCandidates(db: SqliteStore, opts: FindCandidatesOpts): string[] {
  const sinceIso = new Date(Date.now() - opts.lookbackDays * 86400_000).toISOString();
  const rows = db.all<{ skillName: string; successRate: number; cnt: number }>(
    `SELECT skill_name AS skillName,
            CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) AS successRate,
            COUNT(*) AS cnt
     FROM skill_usage
     WHERE invoked_at >= ?
     GROUP BY skill_name
     HAVING cnt >= ? AND successRate < ?
     ORDER BY successRate ASC, cnt DESC
     LIMIT ?`,
    sinceIso,
    opts.minInvocationsForCandidate,
    opts.successRateThreshold,
    opts.limit,
  );
  return rows.map(r => r.skillName);
}

// ═══════════════════════════════════════════════════════════════════════════
// Execute Decision
// ═══════════════════════════════════════════════════════════════════════════

interface DecisionOutcome {
  newHash: string | null;
  patchesApplied?: string;   // JSON 字符串
  targetSkillName?: string;   // create 时生成的新 skill 名
  /** M7.1: 改动前 SKILL.md 内容（仅 refine 有，create 为 null） */
  previousContent?: string | null;
  /** M7.1: 改动后 SKILL.md 内容（refine + create 都有） */
  newContent?: string | null;
  error?: string;
}

async function executeDecision(params: {
  decision: EvolverDecision;
  evidence: EvolutionEvidence;
  userSkillsDir: string;
}): Promise<DecisionOutcome> {
  const { decision, evidence, userSkillsDir } = params;

  if (decision.decision === 'skip') {
    return { newHash: null };
  }

  if (decision.decision === 'refine') {
    return executeRefine(decision, evidence, userSkillsDir);
  }

  // create
  return executeCreate(decision, userSkillsDir);
}

async function executeRefine(
  decision: EvolverDecision,
  evidence: EvolutionEvidence,
  userSkillsDir: string,
): Promise<DecisionOutcome> {
  if (!evidence.currentSkillMd) {
    return { newHash: null, error: 'SKILL.md missing at refine time' };
  }
  const patches = decision.changes?.patches ?? [];
  if (patches.length === 0) {
    return { newHash: null, error: 'no patches provided' };
  }

  // 逐条应用（严格子串匹配 + 唯一）
  let working = evidence.currentSkillMd;
  for (const patch of patches) {
    if (!patch.old) {
      return { newHash: null, error: 'patch.old is empty' };
    }
    const first = working.indexOf(patch.old);
    if (first === -1) {
      return { newHash: null, error: `patch.old not found: "${patch.old.slice(0, 40)}..."` };
    }
    const last = working.lastIndexOf(patch.old);
    if (first !== last) {
      return { newHash: null, error: `patch.old matches multiple locations` };
    }
    working = working.slice(0, first) + patch.new + working.slice(first + patch.old.length);
  }

  // 安全扫描（evolved 结果也要走完整 scan）
  const scan = scanSkillMd(working, { expectedName: evidence.skillName });
  if (!scan.ok) {
    return {
      newHash: null,
      error: `security scan rejected evolved content: ${scan.frontmatterError ?? `riskLevel=${scan.riskLevel}`}`,
      patchesApplied: JSON.stringify(patches),
    };
  }

  // 直接走 editSkillInternal（complete atomic write + .bak + manifest 更新链路）
  const res = await editSkillInternal({
    name: evidence.skillName,
    content: working,
    userSkillsDir,
  });
  if (!res.success) {
    return {
      newHash: null,
      error: res.error ?? 'editSkillInternal failed',
      patchesApplied: JSON.stringify(patches),
    };
  }

  return {
    newHash: computeSkillHash(working),
    patchesApplied: JSON.stringify(patches),
    previousContent: evidence.currentSkillMd,
    newContent: working,
  };
}

async function executeCreate(
  decision: EvolverDecision,
  userSkillsDir: string,
): Promise<DecisionOutcome> {
  const suggestedName = decision.changes?.suggestedName ?? '';
  const newSkillMd = decision.changes?.new_skill_md ?? '';
  if (!SKILL_NAME_REGEX.test(suggestedName)) {
    return { newHash: null, error: `invalid suggestedName: ${suggestedName}` };
  }

  const targetPath = path.join(userSkillsDir, suggestedName, 'SKILL.md');
  if (fs.existsSync(targetPath)) {
    return { newHash: null, error: `skill "${suggestedName}" already exists` };
  }

  const res = await createSkillInternal({
    name: suggestedName,
    content: newSkillMd,
    userSkillsDir,
  });
  if (!res.success) {
    return {
      newHash: null,
      error: res.error ?? 'createSkillInternal failed',
      patchesApplied: JSON.stringify({ name: suggestedName }),
      targetSkillName: suggestedName,
    };
  }

  // 走进 evolver 创建的 skill 来源标记为 agent-created（createSkillInternal 已处理），
  // 但我们额外加一个标记让 manifest 可审计：这里可选择 upsert 增加 createdAt 说明
  // skill_evolution_log 本身已记录 decision='create'，manifest 保持 agent-created 即可。
  try {
    upsertManifestEntry(userSkillsDir, {
      name: suggestedName,
      sha256: computeSkillHash(newSkillMd),
      source: 'agent-created',
      createdAt: new Date().toISOString(),
    });
  } catch {
    // manifest upsert 失败不算致命错误（createSkillInternal 已写入）
  }

  return {
    newHash: computeSkillHash(newSkillMd),
    patchesApplied: JSON.stringify({ name: suggestedName }),
    targetSkillName: suggestedName,
    previousContent: null,   // create 前不存在
    newContent: newSkillMd,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Audit Log
// ═══════════════════════════════════════════════════════════════════════════

interface LogDecisionParams {
  skillName: string;
  decision: 'refine' | 'create' | 'skip';
  reasoning: string;
  evidence: EvolutionEvidence;
  previousHash: string | null;
  newHash: string | null;
  patchesApplied?: string;
  model: string | null;
  durationMs: number;
  errorMessage?: string;
  /** M7.1: 改动前后 SKILL.md 内容（供前端 diff + 回滚使用；skip/失败为 null） */
  previousContent?: string | null;
  newContent?: string | null;
}

function logDecision(db: SqliteStore, p: LogDecisionParams): void {
  try {
    const evidenceSummary = JSON.stringify({
      summaries: p.evidence.summaries.length,
      recentUsages: p.evidence.recentUsages.length,
      stats: p.evidence.stats,
    });
    db.run(
      `INSERT INTO skill_evolution_log (
        skill_name, decision, reasoning,
        evidence_count, evidence_summary,
        patches_applied, previous_hash, new_hash,
        model_used, duration_ms, error_message,
        previous_content, new_content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.skillName,
      p.decision,
      p.reasoning.slice(0, 1000),
      p.evidence.summaries.length + p.evidence.recentUsages.length,
      evidenceSummary,
      p.patchesApplied ?? null,
      p.previousHash,
      p.newHash,
      p.model,
      p.durationMs,
      p.errorMessage?.slice(0, 1000) ?? null,
      p.previousContent ?? null,
      p.newContent ?? null,
    );
  } catch (err) {
    log.warn('skill_evolution_log 写入失败', { err: String(err), skill: p.skillName });
  }
}
