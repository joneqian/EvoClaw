import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import {
  AgentManager,
  SOUL_BASE,
  generateIdentityMd,
} from '../agent/agent-manager.js';
import { reconcileBootstrapState } from '../agent/bootstrap-reconciler.js';

/**
 * BOOTSTRAP reconcile 自愈逻辑测试
 *
 * 设计目标：替代 chat.ts/channel-message-handler.ts 的硬编码 12 轮兜底，
 * 改用基于"用户行为证据"的状态机自愈：
 *   - BOOTSTRAP.md 被 Agent 主动清空 → 完成
 *   - USER.md 非空（初始为 ''）→ 完成
 *   - SOUL.md / IDENTITY.md 与 template 不同 → 完成
 *   - 老 workspace（缺 bootstrap_seeded_at）+ 已配置 → 自愈补行
 *   - 30 轮兜底强清（远高于原 12 轮，仅作 safety net）
 */

const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_SQL = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');
const MIGRATION_CONVLOG_SQL = fs.readFileSync(path.join(migrationsDir, '004_conversation_log.sql'), 'utf-8');
const MIGRATION_021_SQL = fs.readFileSync(path.join(migrationsDir, '021_conversation_log_hierarchy.sql'), 'utf-8');
const MIGRATION_WORKSPACE_STATE_SQL = fs.readFileSync(path.join(migrationsDir, '014_workspace_state.sql'), 'utf-8');
const MIGRATION_033_SQL = fs.readFileSync(path.join(migrationsDir, '033_agents_team_coordinator.sql'), 'utf-8');
const MIGRATION_031_SQL = fs.readFileSync(path.join(migrationsDir, '031_team_mode.sql'), 'utf-8');
const MIGRATION_035_SQL = fs.readFileSync(path.join(migrationsDir, '035_team_workflow_template.sql'), 'utf-8');

describe('reconcileBootstrapState', () => {
  let store: SqliteStore;
  let manager: AgentManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-reconciler-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');
    const agentsDir = path.join(tmpDir, 'agents');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_SQL);
    store.exec(MIGRATION_CONVLOG_SQL);
    store.exec(MIGRATION_021_SQL);
    store.exec(MIGRATION_WORKSPACE_STATE_SQL);
    store.exec(MIGRATION_033_SQL);
    store.exec(MIGRATION_031_SQL);
    store.exec(MIGRATION_035_SQL);
    try { store.exec('ALTER TABLE agents ADD COLUMN last_chat_at TEXT'); } catch { /* 已存在 */ }
    manager = new AgentManager(store, agentsDir);
  });

  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('刚创建的 Agent — BOOTSTRAP 与 profile 都是模板默认 → 不应 reconcile', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(false);
    expect(result.setupCompleted).toBe(false);
    expect(manager.isSetupCompleted(agent.id)).toBe(false);
    // BOOTSTRAP.md 仍存在
    const bs = manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md');
    expect(bs && bs.trim().length > 0).toBe(true);
  });

  it('Agent 主动清空 BOOTSTRAP.md → 应 reconcile 完成', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    manager.writeWorkspaceFile(agent.id, 'BOOTSTRAP.md', '');

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
    expect(result.reason).toBe('bootstrap_cleared');
    expect(manager.isSetupCompleted(agent.id)).toBe(true);
  });

  it('BOOTSTRAP.md 被删除 → 应 reconcile 完成', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    const bsPath = path.join(manager.getWorkspacePath(agent.id), 'BOOTSTRAP.md');
    fs.rmSync(bsPath);

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
    expect(manager.isSetupCompleted(agent.id)).toBe(true);
  });

  it('USER.md 被编辑（非空）→ 应 reconcile 完成（即使 BOOTSTRAP 还在）', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    manager.writeWorkspaceFile(agent.id, 'USER.md', '# 用户\n\n名字: 张三\n时区: Asia/Shanghai');

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
    expect(result.reason).toBe('profile_configured');
    // 自动清 BOOTSTRAP.md（已完成出生）
    const bs = manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md');
    expect(bs ?? '').toBe('');
  });

  it('SOUL.md 与 SOUL_BASE 不同 → 应 reconcile 完成', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    manager.writeWorkspaceFile(agent.id, 'SOUL.md', SOUL_BASE + '\n\n## 我的口头禅\n喵～');

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
    expect(result.reason).toBe('profile_configured');
  });

  it('IDENTITY.md 与初始 generateIdentityMd 不同 → 应 reconcile 完成', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    const newIdentity = generateIdentityMd(agent).replace('to be discovered', 'witty and warm');
    manager.writeWorkspaceFile(agent.id, 'IDENTITY.md', newIdentity);

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
  });

  it('已 setupCompleted → 幂等，不重复 reconcile', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    manager.setWorkspaceState(agent.id, 'setup_completed_at', new Date().toISOString());

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(false);
    expect(result.setupCompleted).toBe(true);
    expect(result.reason).toBe('already_completed');
  });

  it('老 workspace（无 bootstrap_seeded_at）+ profile 已配置 → 自愈补行', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    // 模拟老 workspace：手工清掉 workspace_state 行
    store.run('DELETE FROM workspace_state WHERE agent_id = ?', agent.id);
    expect(manager.getWorkspaceState(agent.id, 'bootstrap_seeded_at')).toBeNull();

    // 用户已编辑 USER.md
    manager.writeWorkspaceFile(agent.id, 'USER.md', '名字: 张三');

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
    expect(result.reason).toBe('legacy_migration');
    // 同时回填 bootstrap_seeded_at + setup_completed_at
    expect(manager.getWorkspaceState(agent.id, 'bootstrap_seeded_at')).toBeTruthy();
    expect(manager.getWorkspaceState(agent.id, 'setup_completed_at')).toBeTruthy();
  });

  it('老 workspace（无 bootstrap_seeded_at）+ 全是模板默认 → 不动', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    store.run('DELETE FROM workspace_state WHERE agent_id = ?', agent.id);

    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });

    expect(result.repaired).toBe(false);
    expect(result.setupCompleted).toBe(false);
  });

  it('historyLength >= 30 兜底 + BOOTSTRAP 仍非空 → 强清并 warn', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = reconcileBootstrapState({
      agentId: agent.id,
      agentManager: manager,
      historyLength: 32,
    });

    expect(result.repaired).toBe(true);
    expect(result.setupCompleted).toBe(true);
    expect(result.reason).toBe('history_fallback');
    const bs = manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md');
    expect(bs ?? '').toBe('');

    warnSpy.mockRestore();
  });

  it('historyLength = 25（未到兜底）+ profile 默认 → 不强清', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });

    const result = reconcileBootstrapState({
      agentId: agent.id,
      agentManager: manager,
      historyLength: 25,
    });

    expect(result.repaired).toBe(false);
    expect(result.setupCompleted).toBe(false);
  });

  it('reconcile 完成后写 setup_completed_at 为 ISO 时间戳', async () => {
    const agent = await manager.createAgent({ name: '小李', emoji: '🐱' });
    manager.writeWorkspaceFile(agent.id, 'USER.md', 'has content');

    const before = Date.now();
    const result = reconcileBootstrapState({ agentId: agent.id, agentManager: manager });
    const after = Date.now();

    expect(result.repaired).toBe(true);
    const completedAt = manager.getWorkspaceState(agent.id, 'setup_completed_at');
    expect(completedAt).toBeTruthy();
    const completedTs = Date.parse(completedAt!);
    expect(completedTs).toBeGreaterThanOrEqual(before);
    expect(completedTs).toBeLessThanOrEqual(after);
  });
});
