/**
 * Skill Evolution Evidence Gatherer — M7 Phase 3
 *
 * Evolver 决策前的证据聚合：
 * - 当前 SKILL.md 内容 + hash
 * - 最近 N 条 session 摘要（Phase 2 生成）
 * - 最近 K 条原始调用（含 error_summary + 用户反馈）
 * - 聚合统计（成功率/耗时/反馈计数）
 *
 * 输出 EvolutionEvidence，供 evolver-prompt 渲染成 LLM 输入，
 * 也供 skill_evolution_log.evidence_summary 字段存档。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SkillAggregateStats, SkillUsageRow, SkillUsageStore, SkillUsageSummaryRow } from './skill-usage-store.js';
import type { SkillManifestEntry } from './skill-manifest.js';
import { computeSkillHash, readManifest } from './skill-manifest.js';

export interface EvolutionEvidence {
  skillName: string;
  /** 当前 SKILL.md 完整内容（null 表示文件不存在） */
  currentSkillMd: string | null;
  /** 当前文件 SHA-256 hash */
  currentHash: string | null;
  /** manifest 中记录的 hash（用于检测用户手改） */
  manifestHash: string | null;
  /** manifest 记录（含 source/createdAt） */
  manifestEntry: SkillManifestEntry | null;
  /** 用户是否手改过（manifest hash ≠ file hash） */
  userModified: boolean;

  /** 最近 N 条 session LLM 摘要 */
  summaries: SkillUsageSummaryRow[];
  /** 最近 K 条原始调用（截断到 10 条，其中失败优先） */
  recentUsages: SkillUsageRow[];
  /** 总体聚合 */
  stats: SkillAggregateStats;
  /** Phase 5: 本 session 是否已调用过该 skill（gatherEvidence 传入 currentSessionKey 时填充） */
  usedInCurrentSession: boolean;
}

export interface GatherEvidenceOptions {
  skillName: string;
  store: SkillUsageStore;
  userSkillsDir: string;
  /** 拉多少条最近摘要（默认 5） */
  summariesLimit?: number;
  /** 拉多少条最近 usage 记录（默认 10） */
  usagesLimit?: number;
  /** 聚合统计回看天数（默认 30） */
  statsDays?: number;
  /** Phase 5: 当前 session key — 设置后 evidence.usedInCurrentSession 会被填充 */
  currentSessionKey?: string;
}

export function gatherEvidence(opts: GatherEvidenceOptions): EvolutionEvidence {
  const {
    skillName, store, userSkillsDir,
    summariesLimit = 5, usagesLimit = 10, statsDays = 30,
  } = opts;

  // 1. 当前 SKILL.md + hash
  const skillMdPath = path.join(userSkillsDir, skillName, 'SKILL.md');
  let currentSkillMd: string | null = null;
  let currentHash: string | null = null;
  try {
    currentSkillMd = fs.readFileSync(skillMdPath, 'utf-8');
    currentHash = computeSkillHash(currentSkillMd);
  } catch {
    // 文件不存在或不可读
  }

  // 2. manifest 比对
  const manifest = readManifest(userSkillsDir);
  const manifestEntry = manifest.get(skillName) ?? null;
  const manifestHash = manifestEntry?.sha256 ?? null;
  const userModified = currentHash !== null && manifestHash !== null && currentHash !== manifestHash;

  // 3. 摘要
  const summaries = store.listSummaries(skillName, summariesLimit);

  // 4. 最近 usage（全 session 跨 session）— 优先取失败的 + 时间倒序
  const recent = store.listRecent(skillName, usagesLimit * 2);
  const failures = recent.filter(r => r.success === 0).slice(0, Math.ceil(usagesLimit / 2));
  const successes = recent.filter(r => r.success === 1).slice(0, Math.floor(usagesLimit / 2));
  const recentUsages = [...failures, ...successes].slice(0, usagesLimit);

  // 5. 统计
  const stats = store.aggregateStats(skillName, statsDays);

  // 6. Phase 5: 本 session 是否用过该 skill
  let usedInCurrentSession = false;
  if (opts.currentSessionKey) {
    try {
      const rows = store.listBySessionAndSkill(opts.currentSessionKey, skillName);
      usedInCurrentSession = rows.length > 0;
    } catch {
      // 查询失败保持 false，不影响主流程
    }
  }

  return {
    skillName,
    currentSkillMd,
    currentHash,
    manifestHash,
    manifestEntry,
    userModified,
    summaries,
    recentUsages,
    stats,
    usedInCurrentSession,
  };
}

/**
 * 判断该 Skill 是否值得进入 Evolver 流程。
 * 返回 null 表示需要 skip（附带 reason）。
 */
export function shouldEvolve(
  evidence: EvolutionEvidence,
  opts: { minEvidenceCount: number; successRateThreshold: number },
): { proceed: true } | { proceed: false; reason: string } {
  if (!evidence.currentSkillMd) {
    return { proceed: false, reason: 'SKILL.md not found' };
  }
  if (evidence.userModified) {
    return { proceed: false, reason: 'user modified skill (hash mismatch with manifest)' };
  }
  const evidenceCount = evidence.summaries.length + evidence.recentUsages.length;
  if (evidenceCount < opts.minEvidenceCount) {
    return { proceed: false, reason: `insufficient evidence (${evidenceCount} < ${opts.minEvidenceCount})` };
  }
  if (evidence.stats.invocationCount === 0) {
    return { proceed: false, reason: 'no recent invocations' };
  }
  if (evidence.stats.successRate >= opts.successRateThreshold) {
    return { proceed: false, reason: `success rate ${(evidence.stats.successRate * 100).toFixed(0)}% >= threshold` };
  }
  return { proceed: true };
}
