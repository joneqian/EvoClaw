/**
 * N1-N5 修复回归测试
 *
 * - N1: escalation SQL alias 显式（fetchActiveTasksWithPlan 取出的 task/plan 行字段正确）
 * - N2: 60min @用户 节流（30min cooldown）
 * - N3: peer-roster 缓存命中时 re-filter inactive agent
 * - N4: PingPongRecord taskIds 时间窗外自动剔除
 * - N5: FeishuPeerBotRegistry.gc 清理过期 entry
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { BindingRouter } from '../../routing/binding-router.js';
import { AgentManager } from '../../agent/agent-manager.js';
import { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import { EscalationService } from '../../agent/team-mode/escalation-service.js';
import { LoopGuard, PING_PONG_THRESHOLD, PING_PONG_WINDOW_MS } from '../../agent/team-mode/loop-guard.js';
import { PeerRosterService } from '../../agent/team-mode/peer-roster-service.js';
import { TeamChannelRegistry } from '../../agent/team-mode/team-channel-registry.js';
import { FeishuPeerBotRegistry } from '../../channel/adapters/feishu/common/peer-bot-registry.js';
import { resetSystemEventsForTest } from '../../infrastructure/system-events.js';
import type { TeamChannelAdapter, PeerBotIdentity } from '../../channel/team-mode/team-channel.js';
import type { ChannelManager } from '../../channel/channel-manager.js';

// ─── N1+N2: escalation 列别名 + 60min 节流 ────────────────────────

describe('N1+N2: escalation SQL alias + 60min user @ throttle', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let svc: TaskPlanService;
  let escalation: EscalationService;
  let A: string;
  let B: string;
  let tmpDir: string;
  const groupKey = 'feishu:chat:oc_test';
  let sentMessages: Array<{ peerId: string; content: string }>;
  let mockChannelManager: ChannelManager;

  beforeEach(async () => {
    resetSystemEventsForTest();
    store = new SqliteStore(':memory:');
    await new MigrationRunner(store).run();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-n12-'));
    agentManager = new AgentManager(store, tmpDir);
    A = (await agentManager.createAgent({ name: 'PM' })).id;
    B = (await agentManager.createAgent({ name: 'BE' })).id;
    store.run(`UPDATE agents SET status='active' WHERE id IN (?, ?)`, A, B);

    const bindingRouter = new BindingRouter(store);
    bindingRouter.addBinding({
      agentId: A, channel: 'feishu', accountId: 'cli_a',
      peerId: null, priority: 0, isDefault: false,
    });

    sentMessages = [];
    mockChannelManager = {
      sendMessage: async (_ch: string, _acc: string, peerId: string, content: string) => {
        sentMessages.push({ peerId, content });
      },
    } as unknown as ChannelManager;

    svc = new TaskPlanService({ store, agentManager });
    escalation = new EscalationService({
      store, taskPlanService: svc, agentManager,
      channelManager: mockChannelManager, bindingRouter,
      tickIntervalMs: 60_000, // 测试时无关
    });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('N1: fetchActiveTasksWithPlan 取出 task/plan 字段对齐（无 t.id 覆盖 p.id）', async () => {
    const planSnap = await svc.createPlan(
      { goal: 'demo', tasks: [{ localId: 't1', title: '测试', assigneeAgentId: B }] },
      { groupSessionKey: groupKey, createdByAgentId: A, initiatorUserId: 'user-1' },
    );
    // 用 reflection 调内部 fetchActiveTasksWithPlan（绕过 TS 的 private 检查）
    const rows = (escalation as unknown as {
      fetchActiveTasksWithPlan: () => Array<{ task: { id: string; plan_id: string }; plan: { id: string } }>;
    }).fetchActiveTasksWithPlan();
    expect(rows.length).toBe(1);
    expect(rows[0].plan.id).toBe(planSnap.id);
    expect(rows[0].task.plan_id).toBe(planSnap.id);
    expect(rows[0].task.id).not.toBe(planSnap.id); // task.id 是 task 主键不是 plan id
  });

  it('N2: 60min @用户 30min 内不会重复触发', async () => {
    const planSnap = await svc.createPlan(
      { goal: 'demo', tasks: [{ localId: 't1', title: '测试', assigneeAgentId: B }] },
      { groupSessionKey: groupKey, createdByAgentId: A, initiatorUserId: 'user-1' },
    );
    // 把 task 的 updated_at 倒退到 65min 前，并先 mark red 模拟之前已触发过 30min 升级
    const longAgo = new Date(Date.now() - 65 * 60_000).toISOString();
    store.run(
      `UPDATE tasks SET updated_at = ?, stale_marker = 'red_30min' WHERE plan_id = ?`,
      longAgo, planSnap.id,
    );

    // 第一次 tick：应触发 @用户
    sentMessages.length = 0;
    await escalation.tick();
    const firstFire = sentMessages.length;
    expect(firstFire).toBeGreaterThan(0);

    // 立刻第二次 tick：30min cooldown 内 → 不应再触发
    sentMessages.length = 0;
    await escalation.tick();
    expect(sentMessages.length).toBe(0);
  });
});

// ─── N3: peer-roster cache hit re-filter ───────────────────────────

describe('N3: peer-roster 缓存命中也按当前 status 过滤', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let registry: TeamChannelRegistry;
  let rosterService: PeerRosterService;
  let A: string;
  let B: string;
  let tmpDir: string;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    await new MigrationRunner(store).run();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-n3-'));
    agentManager = new AgentManager(store, tmpDir);
    A = (await agentManager.createAgent({ name: 'PM' })).id;
    B = (await agentManager.createAgent({ name: 'BE' })).id;
    store.run(`UPDATE agents SET status='active' WHERE id IN (?, ?)`, A, B);

    registry = new TeamChannelRegistry();
    const fakeAdapter: TeamChannelAdapter = {
      channelType: 'feishu',
      classifyInboundMessage: async () => ({ kind: 'stranger' as const }),
      listPeerBots: async (): Promise<PeerBotIdentity[]> => [{ agentId: B, mentionId: 'ou_b' }],
      buildMention: async () => ({ channelType: 'feishu', fallbackText: '', payload: null }),
      renderTaskBoard: () => ({ channelType: 'feishu', fallbackText: '', payload: null }),
      updateTaskBoard: async () => ({ cardId: '' }),
    };
    registry.register('feishu', fakeAdapter);
    rosterService = new PeerRosterService({ agentManager, registry, ttlMs: 60_000 });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('B active → roster 含 B；变 archived 后缓存命中再查 → roster 已剔除', async () => {
    const roster1 = await rosterService.buildRoster(A, 'feishu:chat:oc_x');
    expect(roster1.map((p) => p.agentId)).toEqual([B]);

    // B 变非 active（不调 invalidate，模拟用户在 5min TTL 内停用）
    store.run(`UPDATE agents SET status='archived' WHERE id = ?`, B);

    // 缓存命中路径也应过滤掉
    const roster2 = await rosterService.buildRoster(A, 'feishu:chat:oc_x');
    expect(roster2).toEqual([]);
  });
});

// ─── N4: ping-pong taskIds Map 自动剔除窗口外旧条目 ───────────────────

describe('N4: PingPongRecord.taskIds 窗口外自动 prune', () => {
  it('PING_PONG_WINDOW_MS 之外的 taskId 不会被算入"是否同 task"判定', () => {
    const guard = new LoopGuard();
    const KEY = 'feishu:chat:oc_x';
    let now = 1_700_000_000_000;

    // 先在 t1 上累 PING_PONG_THRESHOLD-1 次（不足以熔断）
    for (let i = 0; i < PING_PONG_THRESHOLD - 1; i++) {
      guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: i % 2 === 0 ? 'A' : 'B',
        toAgentId: i % 2 === 0 ? 'B' : 'A',
        taskId: 't1',
        now: now + i * 100,
      });
    }

    // 跳到 PING_PONG_WINDOW_MS + 1s 之后 — t1 此时应被 pruneTaskIds 清掉
    now = now + PING_PONG_WINDOW_MS + 1_000;

    // 在 t2 上累 PING_PONG_THRESHOLD 次
    let lastDec;
    for (let i = 0; i < PING_PONG_THRESHOLD; i++) {
      lastDec = guard.evaluate({
        groupSessionKey: KEY,
        fromAgentId: i % 2 === 0 ? 'A' : 'B',
        toAgentId: i % 2 === 0 ? 'B' : 'A',
        taskId: 't2',
        now: now + i * 100,
      });
    }
    // 因 t1 已被 prune，taskIds.size === 1 (仅 t2) → 触发熔断
    expect(lastDec!.result).toBe('block');
  });
});

// ─── N5: FeishuPeerBotRegistry.gc 清理过期 entry ────────────────────

describe('N5: FeishuPeerBotRegistry.gc', () => {
  let store: SqliteStore;
  let bindingRouter: BindingRouter;
  let registry: FeishuPeerBotRegistry;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    await new MigrationRunner(store).run();
    bindingRouter = new BindingRouter(store);
    registry = new FeishuPeerBotRegistry({ bindingRouter });
    // 先建 agents 行，否则 bindings FK 会失败
    const insertAgent = (id: string, name: string) =>
      store.run(
        `INSERT INTO agents (id, name, emoji, status, created_at, updated_at) VALUES (?, ?, '🤖', 'active', datetime('now'), datetime('now'))`,
        id, name,
      );
    insertAgent('a-self', 'self');
    insertAgent('a-old', 'old');
    insertAgent('a-fresh', 'fresh');
    insertAgent('a-a', 'a');
  });

  it('过期的 entry 被清掉（用 maxAgeMs=10 + 20ms 等待模拟过期）', async () => {
    // 必须先在 bindings 里注册才会被 listInChat 列出
    bindingRouter.addBinding({ agentId: 'a-self', channel: 'feishu', accountId: 'cli_self', peerId: null, priority: 0, isDefault: false });
    bindingRouter.addBinding({ agentId: 'a-old', channel: 'feishu', accountId: 'cli_old', peerId: null, priority: 0, isDefault: false });
    bindingRouter.addBinding({ agentId: 'a-fresh', channel: 'feishu', accountId: 'cli_fresh', peerId: null, priority: 0, isDefault: false });

    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_old',
      targetUnionId: 'un_old',
      openId: 'ou_old',
    });
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_fresh',
      targetUnionId: 'un_fresh',
      openId: 'ou_fresh',
    });
    // listInChat 返回 (peer1, peer2, plus bindings 兜底候选)，过滤 self 后应至少有 2 个
    const before = registry.listInChat('oc_x', 'cli_self', 'a-self');
    const beforeLearnedCount = before.filter((p) => p.openId).length;
    expect(beforeLearnedCount).toBe(2);

    // 等 20ms 让两个 entry 都"超过" 10ms 阈值
    await new Promise((r) => setTimeout(r, 20));
    const removed = registry.gc(10);
    expect(removed).toBe(2);
    // gc 后 viewer 视角下不再有完整 entry（仍有 bindings 兜底候选，但 openId 都空）
    const after = registry.listInChat('oc_x', 'cli_self', 'a-self');
    expect(after.every((p) => !p.openId)).toBe(true);
  });

  it('default 30d 内的 entry 不被清', () => {
    bindingRouter.addBinding({ agentId: 'a-self', channel: 'feishu', accountId: 'cli_self', peerId: null, priority: 0, isDefault: false });
    bindingRouter.addBinding({ agentId: 'a-a', channel: 'feishu', accountId: 'cli_a', peerId: null, priority: 0, isDefault: false });

    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_a',
      targetUnionId: 'un_a',
      openId: 'ou_a',
    });
    const removed = registry.gc(); // default 30d
    expect(removed).toBe(0);
    const list = registry.listInChat('oc_x', 'cli_self', 'a-self');
    expect(list.find((p) => p.agentId === 'a-a')?.openId).toBe('ou_a');
  });
});
