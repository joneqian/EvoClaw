import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryStore } from '../memory/memory-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import {
  extractAndPersistPeerImpression,
  readPeerImpression,
  _internals,
  type LLMCallFn,
  type PeerImpressionMessage,
} from '../memory/peer-impression-extractor.js';
import type { PeerImpressionL1 } from '@evoclaw/shared';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_FILES = [
  '001_initial.sql',
  '002_memory_units.sql',
  '003_knowledge_graph.sql',
  '038_peer_impression_index.sql',
];

function loadMigrationsInto(store: SqliteStore): void {
  for (const f of MIGRATION_FILES) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
    store.exec(sql);
  }
}

function insertAgent(store: SqliteStore, id: string, name: string): void {
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
    id, name, '🤖', 'active', '{}',
  );
}

function makeMessages(items: Array<[ 'user' | 'assistant', string ]>): PeerImpressionMessage[] {
  return items.map(([role, content]) => ({ role, content }));
}

/** 构造合法 LLM JSON 响应 */
function makeLlmJson(overrides: Partial<{
  l0Summary: string;
  collaborationStyle: string;
  strengths: string[];
  frictions: string[];
  lastTaskOutcome: '完成' | '部分完成' | '未完成' | '搁置' | '未知';
  lastTaskSummary: string;
  wrapInCodeBlock: boolean;
}> = {}): LLMCallFn {
  return async (_system: string, _user: string): Promise<string> => {
    const body = {
      l0Summary: overrides.l0Summary ?? '擅长写代码、沟通直接',
      collaborationStyle: overrides.collaborationStyle ?? '直接果断',
      strengths: overrides.strengths ?? ['代码', '排查 bug'],
      frictions: overrides.frictions ?? ['偶尔催进度'],
      lastTaskOutcome: overrides.lastTaskOutcome ?? '完成',
      lastTaskSummary: overrides.lastTaskSummary ?? '完成了登录页面的 bug 修复',
    };
    const json = JSON.stringify(body);
    return overrides.wrapInCodeBlock ? `\`\`\`json\n${json}\n\`\`\`` : json;
  };
}

function makeBrokenLlm(payload: string): LLMCallFn {
  return async () => payload;
}

describe('extractAndPersistPeerImpression', () => {
  let store: SqliteStore;
  let tmpDir: string;
  const ownerId = 'agent-owner-A';
  const peerId = 'agent-peer-B';

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `peer-impression-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    loadMigrationsInto(store);
    insertAgent(store, ownerId, 'Owner Alice');
    insertAgent(store, peerId, 'Peer Bob');
  });

  afterEach(() => {
    try { store.close(); } catch { /* noop */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('happy path：首次提取应写入 entity 记忆 + KG 三元组', async () => {
    const result = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId,
      ownerAgentName: 'Owner Alice',
      peerAgentId: peerId,
      peerAgentName: 'Peer Bob',
      recentMessages: makeMessages([
        ['assistant', '@Bob 帮我看一下登录 bug 吧'],
        ['user', '已经修了，你下次试试'],
      ]),
      groupSessionKey: 'agent:owner-A:feishu:group:g1',
      db: store,
      llmCall: makeLlmJson(),
    });

    expect(result.skipped).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.memoryId).toBeTruthy();

    // 验证 memory_units 写入
    const ms = new MemoryStore(store);
    const unit = ms.findByMergeKey(ownerId, `peer:${peerId}`);
    expect(unit).not.toBeNull();
    expect(unit!.category).toBe('entity');
    expect(unit!.mergeType).toBe('merge');
    const l1 = JSON.parse(unit!.l1Overview) as PeerImpressionL1;
    expect(l1.peerAgentId).toBe(peerId);
    expect(l1.interactionCount).toBe(1);
    expect(l1.strengths).toContain('代码');
    expect(l1.lastSeenInGroup).toBe('agent:owner-A:feishu:group:g1');

    // 验证 KG 三元组
    const kg = new KnowledgeGraphStore(store);
    const relations = kg.queryByObject(`agent:${peerId}`, 'impression_of');
    expect(relations).toHaveLength(1);
    expect(relations[0]!.subjectId).toBe(unit!.id);
  });

  it('已有印象时应 merge：interactionCount 累加 + frictions/strengths 去重合并', async () => {
    // 第一次
    const r1 = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      ownerAgentName: 'Owner', peerAgentName: 'Peer',
      recentMessages: makeMessages([['assistant', 'first round'], ['user', 'ok']]),
      db: store,
      llmCall: makeLlmJson({ strengths: ['代码', '调试'], frictions: ['拖延'] }),
      writeKnowledgeGraph: false,
    });
    expect(r1.skipped).toBe(false);
    expect(r1.merged).toBe(false);

    // 第二次，新观察有重叠（"代码"）和新增（"文档"）
    const r2 = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      ownerAgentName: 'Owner', peerAgentName: 'Peer',
      recentMessages: makeMessages([['assistant', 'second round'], ['user', 'cool']]),
      db: store,
      llmCall: makeLlmJson({
        strengths: ['代码', '文档'],
        frictions: ['拖延', '需求理解偏差'],
      }),
      writeKnowledgeGraph: false,
    });

    expect(r2.skipped).toBe(false);
    expect(r2.merged).toBe(true);
    expect(r2.memoryId).toBe(r1.memoryId);

    // 验证合并结果
    const cur = readPeerImpression(store, ownerId, peerId);
    expect(cur).not.toBeNull();
    expect(cur!.l1.interactionCount).toBe(2);
    expect(cur!.l1.strengths.sort()).toEqual(['代码', '文档', '调试'].sort());
    expect(cur!.l1.frictions.sort()).toEqual(['拖延', '需求理解偏差'].sort());
  });

  it('LLM 返回非法 JSON 时应 skipped 且不写库', async () => {
    const result = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      recentMessages: makeMessages([['assistant', 'hi'], ['user', 'hello']]),
      db: store,
      llmCall: makeBrokenLlm('this is not json at all'),
      writeKnowledgeGraph: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid-output');

    const ms = new MemoryStore(store);
    expect(ms.findByMergeKey(ownerId, `peer:${peerId}`)).toBeNull();
  });

  it('LLM 输出 schema 不匹配（缺字段）时应 skipped', async () => {
    const result = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      recentMessages: makeMessages([
        ['assistant', '我们一起把今天的登录问题排查一下吧'],
        ['user', '好，我去看看后端日志'],
      ]),
      db: store,
      llmCall: makeBrokenLlm(JSON.stringify({ collaborationStyle: '只给一个字段' })),
      writeKnowledgeGraph: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('invalid-output');
  });

  it('容忍 LLM 用 ```json``` 代码块包裹 JSON', async () => {
    const result = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      recentMessages: makeMessages([
        ['assistant', '麻烦看一下需求 #123，截止本周五'],
        ['user', '收到，没问题'],
      ]),
      db: store,
      llmCall: makeLlmJson({ wrapInCodeBlock: true }),
      writeKnowledgeGraph: false,
    });

    expect(result.skipped).toBe(false);
    expect(result.memoryId).toBeTruthy();
  });

  it('owner == peer 时应 skipped（自我引用）', async () => {
    const result = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: ownerId,
      recentMessages: makeMessages([['assistant', 'a'], ['user', 'b']]),
      db: store,
      llmCall: makeLlmJson(),
      writeKnowledgeGraph: false,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('self-reference');
  });

  it('空消息列表 / 过短文本应 skipped', async () => {
    const r1 = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      recentMessages: [],
      db: store,
      llmCall: makeLlmJson(),
      writeKnowledgeGraph: false,
    });
    expect(r1.skipped).toBe(true);
    expect(r1.reason).toBe('no-messages');

    const r2 = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      recentMessages: makeMessages([['user', 'hi']]),
      db: store,
      llmCall: makeLlmJson(),
      writeKnowledgeGraph: false,
    });
    expect(r2.skipped).toBe(true);
    expect(r2.reason).toBe('conversation-too-short');
  });

  it('writeKnowledgeGraph=false 时不写 KG', async () => {
    const result = await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, peerAgentId: peerId,
      recentMessages: makeMessages([['assistant', 'long enough message text'], ['user', 'roger']]),
      db: store,
      llmCall: makeLlmJson(),
      writeKnowledgeGraph: false,
    });
    expect(result.skipped).toBe(false);

    const kg = new KnowledgeGraphStore(store);
    const rels = kg.queryByObject(`agent:${peerId}`, 'impression_of');
    expect(rels).toHaveLength(0);
  });

  it('readPeerImpression 取不到时返回 null', () => {
    const cur = readPeerImpression(store, ownerId, peerId);
    expect(cur).toBeNull();
  });
});

describe('_internals', () => {
  it('parseLlmOutput 容忍 ```json 包裹和前后空白', () => {
    const valid = '\n  ```json\n' + JSON.stringify({
      l0Summary: '一行摘要', collaborationStyle: '直接', strengths: [], frictions: [],
      lastTaskOutcome: '未知', lastTaskSummary: '',
    }) + '\n```\n';
    const r = _internals.parseLlmOutput(valid);
    expect(r.ok).toBe(true);
  });

  it('dedupCap 去重并截断', () => {
    const out = _internals.dedupCap(['a', 'b', 'a', 'c', '', '  ', 'd'], 3);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('parseExistingL1 容忍非 JSON / 缺字段', () => {
    expect(_internals.parseExistingL1(undefined)).toBeNull();
    expect(_internals.parseExistingL1('{invalid')).toBeNull();
    expect(_internals.parseExistingL1('{"foo":"bar"}')).toBeNull();
  });

  it('mergeImpression 累加 interactionCount 并保留新风格', () => {
    const l1 = _internals.mergeImpression({
      peerAgentId: 'p',
      peerName: 'Peer',
      existing: {
        peerAgentId: 'p',
        peerName: 'Peer',
        collaborationStyle: '旧风格',
        strengths: ['s1'],
        frictions: ['f1'],
        interactionCount: 3,
        lastInteractionAt: '2026-01-01T00:00:00Z',
        lastTaskOutcome: '完成',
        lastTaskSummary: '旧任务',
      },
      llm: {
        l0Summary: '',
        collaborationStyle: '新风格',
        strengths: ['s1', 's2'],
        frictions: ['f2'],
        lastTaskOutcome: '搁置',
        lastTaskSummary: '新任务',
      },
      lastInteractionAt: '2026-05-06T00:00:00Z',
      lastSeenInGroup: 'g1',
    });
    expect(l1.collaborationStyle).toBe('新风格');
    expect(l1.interactionCount).toBe(4);
    expect(l1.strengths.sort()).toEqual(['s1', 's2'].sort());
    expect(l1.frictions.sort()).toEqual(['f1', 'f2'].sort());
    expect(l1.lastSeenInGroup).toBe('g1');
  });
});
