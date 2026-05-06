import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryStore } from '../memory/memory-store.js';
import {
  triggerPeerImpressionExtraction,
  _clearInFlightLocks,
} from '../memory/peer-impression-hook.js';
import type { LLMCallFn, PeerImpressionMessage } from '../memory/peer-impression-extractor.js';
import type { MemoryUnit, PeerImpressionL1 } from '@evoclaw/shared';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_FILES = [
  '001_initial.sql',
  '002_memory_units.sql',
  '003_knowledge_graph.sql',
  '038_peer_impression_index.sql',
];

function loadMigrationsInto(store: SqliteStore): void {
  for (const f of MIGRATION_FILES) {
    store.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));
  }
}

function insertAgent(store: SqliteStore, id: string, name: string): void {
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
    id, name, '🤖', 'active', '{}',
  );
}

function makeLlmJson(): LLMCallFn {
  return async () => JSON.stringify({
    l0Summary: 'Peer 印象摘要：擅长写代码',
    collaborationStyle: '直接果断',
    strengths: ['代码', '排查 bug'],
    frictions: [],
    lastTaskOutcome: '完成',
    lastTaskSummary: '完成了登录页 bug 修复',
  });
}

function recentMessages(): PeerImpressionMessage[] {
  return [
    { role: 'assistant', content: '@Bob 帮我看一下登录的 bug 吧，今天必须修完' },
    { role: 'user', content: '收到，我去查一下后端日志' },
  ];
}

describe('triggerPeerImpressionExtraction', () => {
  let store: SqliteStore;
  let tmpDir: string;
  const ownerId = 'agent-owner';
  const peerId = 'agent-peer';

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `peer-impression-hook-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    loadMigrationsInto(store);
    insertAgent(store, ownerId, 'Owner');
    insertAgent(store, peerId, 'Peer');
    _clearInFlightLocks();
  });

  afterEach(() => {
    try { store.close(); } catch { /* noop */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    _clearInFlightLocks();
  });

  it('cron / subagent / heartbeat / boot session 跳过（non-main-turn）', async () => {
    const markers = [':cron:', ':subagent:', ':heartbeat:', ':boot'];
    for (const m of markers) {
      const r = await triggerPeerImpressionExtraction({
        ownerAgentId: ownerId,
        fromPeerAgentId: peerId,
        chatType: 'group',
        sessionKey: `agent:owner${m}feishu:group:g1`,
        recentMessages: recentMessages(),
        db: store,
        llmCall: makeLlmJson(),
      });
      expect(r.triggered).toBe(false);
      expect(r.reason).toBe('non-main-turn');
    }
  });

  it('chatType=private 跳过（not-group）', async () => {
    const r = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'private',
      sessionKey: 'agent:owner:feishu:dm:u1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('not-group');
  });

  it('fromPeerAgentId 缺失 → 跳过（no-peer）', async () => {
    const r = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('no-peer');
  });

  it('owner == peer → 跳过（self-reference）', async () => {
    const r = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: ownerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('self-reference');
  });

  it('happy path：首次成功提取并写库（triggered=true, merged=false）', async () => {
    const r = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      ownerAgentName: 'Owner',
      fromPeerAgentId: peerId,
      fromPeerAgentName: 'Peer',
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      groupSessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r.triggered).toBe(true);
    expect(r.merged).toBe(false);
    expect(r.memoryId).toBeTruthy();

    const ms = new MemoryStore(store);
    const unit = ms.findByMergeKey(ownerId, `peer:${peerId}`) as MemoryUnit;
    expect(unit).not.toBeNull();
    const l1 = JSON.parse(unit.l1Overview) as PeerImpressionL1;
    expect(l1.lastSeenInGroup).toBe('agent:owner:feishu:group:g1');
  });

  it('限速命中：10min 窗口内第二次跳过（rate-limited）', async () => {
    const r1 = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r1.triggered).toBe(true);

    const r2 = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe('rate-limited');
  });

  it('rateLimitMs=0 时不限速', async () => {
    const r1 = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
      rateLimitMs: 0,
    });
    expect(r1.triggered).toBe(true);

    const r2 = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
      rateLimitMs: 0,
    });
    expect(r2.triggered).toBe(true);
    expect(r2.merged).toBe(true);
  });

  it('闭包防重入：并发 2 次同 owner+peer，第二次返回 in-progress', async () => {
    // 用一个慢 LLM 模拟未结束的 in-flight
    let resolveLlm: (v: string) => void = () => {};
    const slowLlm: LLMCallFn = () => new Promise(r => { resolveLlm = r; });

    const p1 = triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: slowLlm,
    });

    // 立即发起第二次
    const r2 = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toBe('in-progress');

    // 释放第一个
    resolveLlm(JSON.stringify({
      l0Summary: '一行摘要 OK',
      collaborationStyle: '直接',
      strengths: [],
      frictions: [],
      lastTaskOutcome: '未知',
      lastTaskSummary: '',
    }));
    const r1 = await p1;
    expect(r1.triggered).toBe(true);
  });

  it('extractor 因输入不合法返回 skipped 时，hook 返回 triggered=false 且带 reason', async () => {
    const r = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      // 故意空消息 → extractor 返回 reason=no-messages
      recentMessages: [],
      db: store,
      llmCall: makeLlmJson(),
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('no-messages');
  });

  it('llmCall 抛错时不破坏调用方（hook 返回 triggered=false）', async () => {
    const explodingLlm: LLMCallFn = () => Promise.reject(new Error('boom'));
    const r = await triggerPeerImpressionExtraction({
      ownerAgentId: ownerId,
      fromPeerAgentId: peerId,
      chatType: 'group',
      sessionKey: 'agent:owner:feishu:group:g1',
      recentMessages: recentMessages(),
      db: store,
      llmCall: explodingLlm,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('llm-error');
  });
});
