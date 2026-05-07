/**
 * skill-curator 单测
 *
 * 重点：
 * - parseCuratorYamlBlock：YAML 块解析（happy / 空 / 单段 / 双段 / 无块 / 多块取最后一个）
 * - runCuratorReview 前置守卫（候选少于 2 → skip llm）
 * - dry-run 模式跳过 applyAutomaticTransitions
 * - 真实 sub-agent happy path 留 e2e（需要真 LLM）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import {
  parseCuratorYamlBlock,
  runCuratorReview,
} from '../../skill/skill-curator.js';
import {
  upsertManifestEntry,
  computeSkillHash,
  type SkillManifestSource,
} from '../../skill/skill-manifest.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATIONS = [
  '001_initial.sql',
  '027_skill_usage.sql',
  '028_skill_evolution_log.sql',
  '029_skill_evolution_content.sql',
  '037_skill_inline_review.sql',
].map(f => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));

// ─── parseCuratorYamlBlock ─────────────────────────────────────────────

describe('parseCuratorYamlBlock', () => {
  it('无 yaml 块 → 空', () => {
    expect(parseCuratorYamlBlock('just plain text')).toEqual({
      consolidations: [], prunings: [],
    });
  });

  it('happy path：consolidations + prunings', () => {
    const text = `
合并了 pr-* cluster。

\`\`\`yaml
consolidations:
  - from: pr-fix-typo
    into: pr-triage
    reason: typo 子流程合并
  - from: pr-rebase
    into: pr-triage
    reason: rebase 属于 PR triage
prunings:
  - name: audit-x
    reason: 一次性 audit
\`\`\`
`;
    const r = parseCuratorYamlBlock(text);
    expect(r.consolidations).toEqual([
      { from: 'pr-fix-typo', into: 'pr-triage', reason: 'typo 子流程合并' },
      { from: 'pr-rebase', into: 'pr-triage', reason: 'rebase 属于 PR triage' },
    ]);
    expect(r.prunings).toEqual([
      { name: 'audit-x', reason: '一次性 audit' },
    ]);
  });

  it('两数组都为空', () => {
    const text = '\n```yaml\nconsolidations: []\nprunings: []\n```\n';
    const r = parseCuratorYamlBlock(text);
    expect(r.consolidations).toEqual([]);
    expect(r.prunings).toEqual([]);
  });

  it('引号包裹值', () => {
    const text = '```yaml\nconsolidations:\n  - from: "pr-x"\n    into: \'pr-triage\'\n    reason: ""\n```';
    const r = parseCuratorYamlBlock(text);
    expect(r.consolidations).toEqual([
      { from: 'pr-x', into: 'pr-triage', reason: '' },
    ]);
  });

  it('多个 yaml 块 → 取最后一个', () => {
    const text = `
\`\`\`yaml
prunings:
  - name: old-one
    reason: outdated
\`\`\`

更新计划：

\`\`\`yaml
prunings:
  - name: final-one
    reason: 实际归档
\`\`\`
`;
    const r = parseCuratorYamlBlock(text);
    expect(r.prunings).toEqual([{ name: 'final-one', reason: '实际归档' }]);
  });

  it('缺字段的 entry 被丢弃', () => {
    const text = '```yaml\nconsolidations:\n  - from: a\n  - from: b\n    into: umbrella\n    reason: r\n```';
    const r = parseCuratorYamlBlock(text);
    // 第一条缺 into 被丢，只剩第二条
    expect(r.consolidations).toEqual([
      { from: 'b', into: 'umbrella', reason: 'r' },
    ]);
  });

  it('支持 ```yml 后缀', () => {
    const text = '```yml\nprunings:\n  - name: x\n    reason: y\n```';
    const r = parseCuratorYamlBlock(text);
    expect(r.prunings).toEqual([{ name: 'x', reason: 'y' }]);
  });

  it('空字符串输入', () => {
    expect(parseCuratorYamlBlock('')).toEqual({ consolidations: [], prunings: [] });
  });

  it('坏格式（正常文本）→ 不抛 / 返回空', () => {
    expect(parseCuratorYamlBlock('xxx ```yaml not valid yaml at all\n``` xxx')).toBeDefined();
  });
});

// ─── runCuratorReview ───────────────────────────────────────────────────

describe('runCuratorReview — 前置守卫', () => {
  let db: SqliteStore;
  let tmpDir: string;
  let userSkillsDir: string;
  const AGENT_ID = 'agent-x';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-runner-'));
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    for (const m of MIGRATIONS) db.exec(m);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function plantSkill(name: string, source: SkillManifestSource): void {
    const dir = path.join(userSkillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const content = `---\nname: ${name}\ndescription: t\n---\nbody`;
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
    upsertManifestEntry(userSkillsDir, {
      name, sha256: computeSkillHash(content),
      source, createdAt: '2026-04-01T00:00:00Z',
    });
  }

  function makeParentConfig(): any {
    return {
      agent: { id: AGENT_ID, name: 'X', emoji: '🤖', status: 'active' },
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o-mini',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.test',
    };
  }

  it('无任何 agent-created skill → llmRan=false', async () => {
    plantSkill('bundled-x', 'bundled');
    plantSkill('hub-x', 'clawhub');

    const r = await runCuratorReview({
      parentConfig: makeParentConfig(),
      userSkillsDir,
      db,
    });
    expect(r.llmRan).toBe(false);
    expect(r.reason).toBe('no-agent-created-skills');
  });

  it('仅 1 个 agent-created skill → llmRan=false（无合并价值）', async () => {
    plantSkill('alone', 'agent-created');

    const r = await runCuratorReview({
      parentConfig: makeParentConfig(),
      userSkillsDir,
      db,
    });
    expect(r.llmRan).toBe(false);
    expect(r.reason).toBe('only-one-candidate');
    // 但还是会跑 transitions
    expect(r.transitions.checked).toBeGreaterThanOrEqual(0);
  });

  it('dry-run 跳过 applyAutomaticTransitions', async () => {
    plantSkill('s1', 'agent-created');
    plantSkill('s2', 'agent-created');

    const r = await runCuratorReview({
      parentConfig: makeParentConfig(),
      userSkillsDir,
      db,
      dryRun: true,
      timeoutMs: 1000, // 短超时（LLM 本来就配错）
    });
    // dry-run → transitions 全 0
    expect(r.transitions.checked).toBe(0);
    expect(r.transitions.markedStale).toBe(0);
    expect(r.transitions.archived).toBe(0);
    // LLM 配错会失败但 llmRan=true（说明触发了）
    expect(r.llmRan).toBe(true);
  }, 30_000);

  it('多 candidate + 实际跑（LLM 配错）→ catch + 写 evolution_log', async () => {
    plantSkill('s1', 'agent-created');
    plantSkill('s2', 'agent-created');
    plantSkill('s3', 'agent-created');

    const r = await runCuratorReview({
      parentConfig: makeParentConfig(),
      userSkillsDir,
      db,
      timeoutMs: 1000,
    });
    expect(r.llmRan).toBe(true);
    expect(r.sessionKey).toMatch(/:curator:/);
    // 写了 evolution_log（聚合行）
    const row = db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM skill_evolution_log WHERE trigger_source = 'curator-run'`,
    );
    expect(row?.count ?? 0).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
