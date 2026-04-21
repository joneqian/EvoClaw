/**
 * Evolver prompt 解析测试 — M7 Phase 3
 */

import { describe, it, expect } from 'vitest';
import { parseEvolverResponse, renderEvidenceAsPrompt } from '../skill/skill-evolver-prompt.js';
import type { EvolutionEvidence } from '../skill/skill-evidence-gatherer.js';

function emptyEvidence(skillName = 'test'): EvolutionEvidence {
  return {
    skillName,
    currentSkillMd: '---\nname: test\ndescription: test\n---\nbody',
    currentHash: 'abc',
    manifestHash: 'abc',
    manifestEntry: null,
    userModified: false,
    summaries: [],
    recentUsages: [],
    stats: {
      skillName,
      invocationCount: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgDurationMs: null,
      lastInvokedAt: null,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
    },
  };
}

describe('parseEvolverResponse', () => {
  it('合法 skip', () => {
    const r = parseEvolverResponse('{"decision":"skip","reasoning":"ok"}');
    expect(r.decision).toBe('skip');
    expect(r.reasoning).toBe('ok');
  });

  it('合法 refine + 有 patches', () => {
    const r = parseEvolverResponse(JSON.stringify({
      decision: 'refine',
      reasoning: 'improve',
      changes: { patches: [{ old: 'foo', new: 'bar' }] },
    }));
    expect(r.decision).toBe('refine');
    expect(r.changes?.patches).toEqual([{ old: 'foo', new: 'bar' }]);
  });

  it('refine 但 patches 缺失 → 降级 skip', () => {
    const r = parseEvolverResponse('{"decision":"refine","reasoning":"?","changes":{}}');
    expect(r.decision).toBe('skip');
    expect(r.reasoning).toContain('[parser]');
  });

  it('create + 完整字段', () => {
    const r = parseEvolverResponse(JSON.stringify({
      decision: 'create',
      reasoning: 'new workflow',
      changes: {
        suggestedName: 'new-skill',
        new_skill_md: '---\nname: new-skill\ndescription: d\n---\nbody',
      },
    }));
    expect(r.decision).toBe('create');
    expect(r.changes?.suggestedName).toBe('new-skill');
  });

  it('create 缺 suggestedName → 降级 skip', () => {
    const r = parseEvolverResponse('{"decision":"create","reasoning":"x","changes":{"new_skill_md":"y"}}');
    expect(r.decision).toBe('skip');
  });

  it('包裹在 markdown fence 里也能解析', () => {
    const r = parseEvolverResponse('```json\n{"decision":"skip","reasoning":"ok"}\n```');
    expect(r.decision).toBe('skip');
  });

  it('非法 decision 值 → 降级 skip', () => {
    const r = parseEvolverResponse('{"decision":"purge","reasoning":"x"}');
    expect(r.decision).toBe('skip');
  });

  it('非 JSON → 降级 skip', () => {
    const r = parseEvolverResponse('oops not json');
    expect(r.decision).toBe('skip');
    expect(r.reasoning).toContain('JSON parse error');
  });

  it('patches 中混入无效项 → 仅保留有效', () => {
    const r = parseEvolverResponse(JSON.stringify({
      decision: 'refine',
      reasoning: 'x',
      changes: {
        patches: [
          { old: 'a', new: 'b' },
          { old: 123, new: 'b' },        // 非字符串 → 丢弃
          { wrongKey: 'x' },              // 结构错 → 丢弃
        ],
      },
    }));
    expect(r.decision).toBe('refine');
    expect(r.changes?.patches).toEqual([{ old: 'a', new: 'b' }]);
  });
});

describe('renderEvidenceAsPrompt', () => {
  it('基本字段渲染', () => {
    const ev = emptyEvidence('myskill');
    const out = renderEvidenceAsPrompt(ev);
    expect(out).toContain('Skill: myskill');
    expect(out).toContain('<skill_md>');
    expect(out).toContain('</skill_md>');
  });

  it('包含失败样本', () => {
    const ev = emptyEvidence();
    ev.recentUsages = [{
      id: 1,
      skillName: 'x',
      agentId: 'a',
      sessionKey: 's',
      invokedAt: '2026-01-01',
      triggerType: 'invoke_skill',
      executionMode: 'inline',
      toolCallsCount: 0,
      success: 0,
      durationMs: 10,
      inputTokens: null,
      outputTokens: null,
      errorSummary: 'timeout',
      userFeedback: null,
      feedbackNote: null,
    }];
    expect(renderEvidenceAsPrompt(ev)).toContain('timeout');
  });
});
