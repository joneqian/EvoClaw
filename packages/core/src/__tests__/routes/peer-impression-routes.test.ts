/**
 * peer-impression routes 端到端测试（M13 #3 PR3）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { createPeerImpressionRoutes } from '../../routes/peer-impression.js';
import { extractAndPersistPeerImpression, type LLMCallFn } from '../../memory/peer-impression-extractor.js';
import type { PeerImpressionL1 } from '@evoclaw/shared';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
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

function makeLlm(summary = '协作画像'): LLMCallFn {
  return async () => JSON.stringify({
    l0Summary: summary,
    collaborationStyle: '直接',
    strengths: ['代码'],
    frictions: [],
    lastTaskOutcome: '完成',
    lastTaskSummary: '完成了登录页 bug 修复',
  });
}

describe('peer-impression routes', () => {
  let db: SqliteStore;
  let app: Hono;
  let tmpDir: string;
  const ownerId = 'agent-owner';
  const peerAId = 'agent-A';
  const peerBId = 'agent-B';

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `peer-imp-routes-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    loadMigrationsInto(db);
    insertAgent(db, ownerId, 'Owner');
    insertAgent(db, peerAId, 'Alice');
    insertAgent(db, peerBId, 'Bob');

    // 种 2 条印象
    await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, ownerAgentName: 'Owner',
      peerAgentId: peerAId, peerAgentName: 'Alice',
      recentMessages: [
        { role: 'assistant', content: '@Alice 帮我看一下登录的 bug 吧，很急' },
        { role: 'user', content: '收到' },
      ],
      db,
      llmCall: makeLlm('Alice 是代码控、沟通直接'),
      writeKnowledgeGraph: false,
    });
    await extractAndPersistPeerImpression({
      ownerAgentId: ownerId, ownerAgentName: 'Owner',
      peerAgentId: peerBId, peerAgentName: 'Bob',
      recentMessages: [
        { role: 'assistant', content: '@Bob 写一份周报模板吧' },
        { role: 'user', content: '收到，明天给你' },
      ],
      db,
      llmCall: makeLlm('Bob 文档控、节奏稳'),
      writeKnowledgeGraph: false,
    });

    app = new Hono();
    app.route('/peer-impressions', createPeerImpressionRoutes({ db }));
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /?agentId=X 返回所有印象', async () => {
    const res = await app.request(`/peer-impressions?agentId=${ownerId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ownerAgentId: string;
      count: number;
      impressions: Array<{ peerAgentId: string; peerName: string; summary: string; l1: PeerImpressionL1 }>;
    };
    expect(body.ownerAgentId).toBe(ownerId);
    expect(body.count).toBe(2);
    const peerIds = body.impressions.map(i => i.peerAgentId).sort();
    expect(peerIds).toEqual([peerAId, peerBId].sort());
  });

  it('GET /?agentId 缺失 → 400', async () => {
    const res = await app.request('/peer-impressions');
    expect(res.status).toBe(400);
  });

  it('GET /:peerAgentId?ownerAgentId=Y 返回单条详情', async () => {
    const res = await app.request(`/peer-impressions/${peerAId}?ownerAgentId=${ownerId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      peerAgentId: string;
      summary: string;
      l1: PeerImpressionL1;
    };
    expect(body.peerAgentId).toBe(peerAId);
    expect(body.summary).toContain('Alice 是代码控');
    expect(body.l1.peerName).toBe('Alice');
    expect(body.l1.interactionCount).toBe(1);
  });

  it('GET /:peerAgentId 不存在 → 404', async () => {
    const res = await app.request(`/peer-impressions/non-exist?ownerAgentId=${ownerId}`);
    expect(res.status).toBe(404);
  });

  it('GET /:peerAgentId 缺 ownerAgentId → 400', async () => {
    const res = await app.request(`/peer-impressions/${peerAId}`);
    expect(res.status).toBe(400);
  });

  it('GET /?limit=1 限制返回数量', async () => {
    const res = await app.request(`/peer-impressions?agentId=${ownerId}&limit=1`);
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number; impressions: unknown[] };
    expect(body.count).toBe(1);
    expect(body.impressions).toHaveLength(1);
  });

  it('GET /?limit 超出范围 → 400', async () => {
    const res = await app.request(`/peer-impressions?agentId=${ownerId}&limit=999`);
    expect(res.status).toBe(400);
  });
});
