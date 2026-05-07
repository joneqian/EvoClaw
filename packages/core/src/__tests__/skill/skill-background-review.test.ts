/**
 * skill-background-review 单测
 *
 * 重点：
 * - source-gated skill_manage：bundled / clawhub / github / local 拒绝；agent-created 通过；create 总放行
 * - runBackgroundReviewAgent 前置守卫：non-privileged parent → skip / no skill context → skip
 * - happy path（触发 → 写 log）暂不在此覆盖（需 mock runEmbeddedAgent，e2e 留给后续）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import {
  createSourceGatedSkillManage,
  runBackgroundReviewAgent,
} from '../../skill/skill-background-review.js';
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

function writeSkill(dir: string, name: string, body: string, source: SkillManifestSource): string {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: t\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  upsertManifestEntry(dir, {
    name, sha256: computeSkillHash(content),
    source, createdAt: '2026-01-01T00:00:00Z',
  });
  return content;
}

describe('createSourceGatedSkillManage', () => {
  let tmpDir: string;
  let userSkillsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgr-gate-'));
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('action=create 总是放行（不 lookup manifest）', async () => {
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'create',
      name: 'new-skill',
      content: '---\nname: new-skill\ndescription: t\n---\nbody',
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(true);
  });

  it('action=patch 对 source=bundled 拒绝', async () => {
    writeSkill(userSkillsDir, 'arxiv', 'old text', 'bundled');
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'patch', name: 'arxiv',
      patch_old: 'old text', patch_new: 'new text',
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(false);
    expect(obj.error).toMatch(/不允许.*bundled/);
  });

  it('action=edit 对 source=clawhub 拒绝', async () => {
    writeSkill(userSkillsDir, 'web-search', 'body', 'clawhub');
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'edit', name: 'web-search',
      content: '---\nname: web-search\ndescription: t\n---\nnew body',
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(false);
    expect(obj.error).toMatch(/clawhub/);
  });

  it('action=delete 对 source=github 拒绝', async () => {
    writeSkill(userSkillsDir, 'gh-tool', 'body', 'github');
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'delete', name: 'gh-tool', confirm: true,
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(false);
    expect(obj.error).toMatch(/github/);
  });

  it('action=patch 对 source=agent-created 放行', async () => {
    writeSkill(userSkillsDir, 'my-skill', 'old text', 'agent-created');
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'patch', name: 'my-skill',
      patch_old: 'old text', patch_new: 'new text',
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(true);
  });

  it('action=patch 对 source=local 拒绝（用户手写也保护）', async () => {
    writeSkill(userSkillsDir, 'user-skill', 'body', 'local');
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'patch', name: 'user-skill',
      patch_old: 'body', patch_new: 'changed',
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(false);
    expect(obj.error).toMatch(/local/);
  });

  it('skill 在 manifest 中不存在（异常路径）→ 透传给 inner（让 inner 报合理错误）', async () => {
    const tool = createSourceGatedSkillManage(userSkillsDir);
    const result = await tool.execute({
      action: 'patch', name: 'no-such-skill',
      patch_old: 'a', patch_new: 'b',
    });
    const obj = JSON.parse(result);
    expect(obj.success).toBe(false);
    // inner 报"找不到 skill"或类似，不应是我们的 source-gate 拒绝
    expect(obj.error).not.toMatch(/不允许.*source/);
  });
});

describe('runBackgroundReviewAgent — 前置守卫', () => {
  let db: SqliteStore;
  let tmpDir: string;
  let userSkillsDir: string;
  const ownerId = 'agent-x';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgr-runner-'));
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    for (const m of MIGRATIONS) db.exec(m);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, ownerId, ownerId, '🤖', 'active');
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 创建一个最小可用的 parentConfig（实际不会被走到，触发 skip 时不调 LLM）
  function makeParentConfig(): any {
    return {
      agent: { id: ownerId, name: 'X', emoji: '🤖', status: 'active' },
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o-mini',
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.test',
    };
  }

  it('父 sessionKey 是 cron → skip non-privileged-parent', async () => {
    const r = await runBackgroundReviewAgent({
      parentConfig: makeParentConfig(),
      parentSessionKey: 'agent:agent-x:cron:job-1',
      ownerAgentId: ownerId,
      recentMessages: [],
      recentSkillsUsed: [],
      userSkillsDir,
      db,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('non-privileged-parent');
  });

  it('父 sessionKey 是 subagent → skip', async () => {
    const r = await runBackgroundReviewAgent({
      parentConfig: makeParentConfig(),
      parentSessionKey: 'agent:agent-x:local:subagent:task-1',
      ownerAgentId: ownerId,
      recentMessages: [],
      recentSkillsUsed: [],
      userSkillsDir,
      db,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('non-privileged-parent');
  });

  it('父 sessionKey 是 background-review → skip（防自递归）', async () => {
    const r = await runBackgroundReviewAgent({
      parentConfig: makeParentConfig(),
      parentSessionKey: 'agent:agent-x:local:background-review:xxx',
      ownerAgentId: ownerId,
      recentMessages: [],
      recentSkillsUsed: [],
      userSkillsDir,
      db,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('non-privileged-parent');
  });

  it('无 agent-created skills + 无 recentSkillsUsed → skip no-skill-context', async () => {
    // 只放一个 bundled skill — 不算 agent-created
    writeSkill(userSkillsDir, 'arxiv', 'body', 'bundled');
    const r = await runBackgroundReviewAgent({
      parentConfig: makeParentConfig(),
      parentSessionKey: 'agent:agent-x:wechat:dm:peer-1',
      ownerAgentId: ownerId,
      recentMessages: [],
      recentSkillsUsed: [],
      userSkillsDir,
      db,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('no-skill-context');
  });

  it('有 agent-created skills 但 LLM 配置无效 → run-error，但不抛异常', async () => {
    writeSkill(userSkillsDir, 'my-skill', 'body', 'agent-created');
    const r = await runBackgroundReviewAgent({
      parentConfig: makeParentConfig(), // sk-test 不是真 key
      parentSessionKey: 'agent:agent-x:wechat:dm:peer-1',
      ownerAgentId: ownerId,
      recentMessages: [
        { id: 'm1', conversationId: 's', role: 'user', content: 'hi', createdAt: new Date().toISOString() },
      ],
      recentSkillsUsed: [],
      userSkillsDir,
      db,
      timeoutMs: 1000, // 短超时确保 e2e 不卡
    });
    // 触发了，跑 LLM 失败/超时不影响 triggered=true
    expect(r.triggered).toBe(true);
    expect(r.sessionKey).toMatch(/:background-review:/);
    // 写了 evolution_log（不论决策结果）
    const row = db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM skill_evolution_log WHERE trigger_source = 'background-review'`,
    );
    expect(row?.count ?? 0).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
