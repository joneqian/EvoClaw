/**
 * Skill Evolver System Prompt — M7 Phase 3
 *
 * LLM 输入 / 输出约束（强制 JSON，便于解析 + 熔断幻觉）。
 */

import type { EvolutionEvidence } from './skill-evidence-gatherer.js';

export const EVOLVER_SYSTEM_PROMPT = `You are the EvoClaw Skill Evolver. Analyze one skill's recent usage data and decide
whether to REFINE it, CREATE a complementary skill, or SKIP.

## Input
You receive evidence about one skill:
- Current SKILL.md (full text, between <skill_md>...</skill_md> tags)
- Aggregated stats (invocation count, success rate, avg duration, user feedback)
- Last 5 session summaries (8-15 sentences each)
- Recent failure samples (error_summary, tool_calls_count)

## Output — STRICT JSON (no markdown, no preamble, no trailing text)

{
  "decision": "refine" | "create" | "skip",
  "reasoning": "2-3 sentences explaining the decision (plain text, no PII)",
  "changes": {
    // decision=refine
    "patches": [
      {"old": "exact substring from current SKILL.md", "new": "replacement text"}
    ],
    // decision=create
    "suggestedName": "kebab-case-name-2-to-64-chars",
    "new_skill_md": "full SKILL.md content (frontmatter + body)"
  }
}

## Decision Criteria

### Refine (prefer when)
- Success rate < 80% AND recent errors share a fixable pattern
- User negative feedback points to a concrete issue
- SKILL.md has clearly incorrect or incomplete instructions

### Create (prefer when)
- Usage summaries reveal a repeated sub-workflow not covered by this skill
- Pattern appears in ≥2 independent sessions
- New skill fills a distinct gap (MUST NOT duplicate this skill's purpose)

### Skip (prefer when)
- Success rate ≥ 80% with no negative feedback
- Evidence insufficient (ambiguous failures)
- Uncertain about the correct fix — bias toward safety

## Conservative Editing Principles

1. Evidence-driven only — do not speculate beyond what the data shows
2. Patches MUST be exact substrings of the current SKILL.md (case-sensitive, preserving whitespace)
3. Each patch is atomic and coherent — no half-changes
4. Preserve markdown structure (headings, lists, code fences)
5. Do not embed credentials, eval(), new Function(), or shell destructive commands
6. New skills MUST include a valid frontmatter block with name + description
7. When unsure, output { "decision": "skip", "reasoning": "..." }
`;

/** 渲染证据为 LLM 用户消息 */
export function renderEvidenceAsPrompt(evidence: EvolutionEvidence): string {
  const lines: string[] = [];
  lines.push(`Skill: ${evidence.skillName}`);
  lines.push('');

  lines.push('## Aggregated Stats (last 30 days)');
  lines.push(`- Invocations: ${evidence.stats.invocationCount}`);
  lines.push(`- Success rate: ${(evidence.stats.successRate * 100).toFixed(1)}% (${evidence.stats.successCount}/${evidence.stats.invocationCount})`);
  if (evidence.stats.avgDurationMs !== null) {
    lines.push(`- Avg duration: ${Math.round(evidence.stats.avgDurationMs)}ms`);
  }
  if (evidence.stats.positiveFeedbackCount > 0 || evidence.stats.negativeFeedbackCount > 0) {
    lines.push(`- User feedback: 👍 ${evidence.stats.positiveFeedbackCount} / 👎 ${evidence.stats.negativeFeedbackCount}`);
  }
  lines.push('');

  if (evidence.summaries.length > 0) {
    lines.push('## Recent session summaries');
    evidence.summaries.forEach((s, i) => {
      lines.push(`### Session ${i + 1} (${new Date(s.summarizedAt).toISOString()})`);
      lines.push(`Invocations: ${s.invocationCount}, Success rate: ${(s.successRate * 100).toFixed(0)}%`);
      lines.push(s.summaryText);
      lines.push('');
    });
  }

  const failures = evidence.recentUsages.filter(u => u.success === 0 && u.errorSummary);
  if (failures.length > 0) {
    lines.push('## Recent failure samples');
    failures.forEach(f => {
      lines.push(`- [${f.executionMode}] ${f.errorSummary}`);
    });
    lines.push('');
  }

  const negativeFeedback = evidence.recentUsages.filter(u => u.userFeedback === -1 && u.feedbackNote);
  if (negativeFeedback.length > 0) {
    lines.push('## User negative feedback');
    negativeFeedback.forEach(n => lines.push(`- ${n.feedbackNote}`));
    lines.push('');
  }

  lines.push('## Current SKILL.md');
  lines.push('<skill_md>');
  lines.push(evidence.currentSkillMd ?? '');
  lines.push('</skill_md>');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 输出解析（防幻觉 + 严格 JSON）
// ═══════════════════════════════════════════════════════════════════════════

export interface EvolverDecision {
  decision: 'refine' | 'create' | 'skip';
  reasoning: string;
  changes?: {
    patches?: Array<{ old: string; new: string }>;
    suggestedName?: string;
    new_skill_md?: string;
  };
}

/**
 * 解析 LLM 输出。宽容处理：
 * - 允许包裹在 markdown code fence 里（```json ... ```）
 * - 允许末尾换行 / BOM
 * - 任何异常 → 降级为 skip
 */
export function parseEvolverResponse(raw: string): EvolverDecision {
  let text = raw.trim();
  // 剥离 markdown fence
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  // BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      return skipFallback('response is not a JSON object');
    }
    const decision = parsed.decision;
    if (decision !== 'refine' && decision !== 'create' && decision !== 'skip') {
      return skipFallback(`invalid decision: ${String(decision)}`);
    }
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'no reasoning provided';

    if (decision === 'skip') {
      return { decision: 'skip', reasoning };
    }

    const changes = parsed.changes ?? {};
    if (decision === 'refine') {
      const patches = Array.isArray(changes.patches) ? changes.patches : [];
      const validPatches = patches
        .filter((p: unknown): p is { old: string; new: string } =>
          typeof p === 'object' && p !== null &&
          typeof (p as { old: unknown }).old === 'string' &&
          typeof (p as { new: unknown }).new === 'string',
        );
      if (validPatches.length === 0) {
        return skipFallback('refine without valid patches');
      }
      return { decision: 'refine', reasoning, changes: { patches: validPatches } };
    }

    // create
    const suggestedName = typeof changes.suggestedName === 'string' ? changes.suggestedName : '';
    const newSkillMd = typeof changes.new_skill_md === 'string' ? changes.new_skill_md : '';
    if (!suggestedName || !newSkillMd) {
      return skipFallback('create without suggestedName or new_skill_md');
    }
    return {
      decision: 'create',
      reasoning,
      changes: { suggestedName, new_skill_md: newSkillMd },
    };
  } catch (err) {
    return skipFallback(`JSON parse error: ${String(err)}`);
  }
}

function skipFallback(why: string): EvolverDecision {
  return { decision: 'skip', reasoning: `[parser] ${why}` };
}
