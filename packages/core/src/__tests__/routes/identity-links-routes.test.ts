/**
 * M13 Phase 1 PR-1B — identity-links REST endpoints 端到端测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { IdentityLinksStore } from '../../routing/identity-links-store.js';
import { createIdentityLinksRoutes } from '../../routes/identity-links.js';

const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_045 = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations', '045_identity_links.sql'),
  'utf-8',
);

describe('identity-links routes', () => {
  let store: SqliteStore;
  let app: Hono;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-id-routes-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_045);
    const idStore = new IdentityLinksStore(store);
    app = new Hono();
    app.route('/identity-links', createIdentityLinksRoutes({ store: idStore }));
  });

  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST + GET round-trip', async () => {
    const post = await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'self', channel: 'feishu', peerId: 'ou_xxx' }),
    });
    expect(post.status).toBe(200);
    const get = await app.request('/identity-links');
    const body = await get.json() as { links: Array<{ canonicalId: string; channel: string; peerId: string }> };
    expect(body.links).toHaveLength(1);
    expect(body.links[0].canonicalId).toBe('self');
    expect(body.links[0].channel).toBe('feishu');
  });

  it('POST 缺参数 → 400', async () => {
    const res = await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'self' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST 无效 JSON → 400', async () => {
    const res = await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('GET ?canonical=X 过滤', async () => {
    await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'self', channel: 'feishu', peerId: 'ou_a' }),
    });
    await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'other', channel: 'feishu', peerId: 'ou_b' }),
    });
    const res = await app.request('/identity-links?canonical=self');
    const body = await res.json() as { links: Array<{ canonicalId: string }> };
    expect(body.links).toHaveLength(1);
    expect(body.links[0].canonicalId).toBe('self');
  });

  it('DELETE ?channel=X&peer=Y 删除指定身份', async () => {
    await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'self', channel: 'feishu', peerId: 'ou_x' }),
    });
    const res = await app.request('/identity-links?channel=feishu&peer=ou_x', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; removed: number };
    expect(body.removed).toBe(1);
    const after = await app.request('/identity-links');
    const list = await after.json() as { links: unknown[] };
    expect(list.links).toHaveLength(0);
  });

  it('DELETE ?canonical=X 删除全部', async () => {
    await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'self', channel: 'feishu', peerId: 'ou_a' }),
    });
    await app.request('/identity-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canonicalId: 'self', channel: 'wecom', peerId: 'userid_b' }),
    });
    const res = await app.request('/identity-links?canonical=self', { method: 'DELETE' });
    const body = await res.json() as { removed: number };
    expect(body.removed).toBe(2);
  });

  it('DELETE 缺参数 → 400', async () => {
    const res = await app.request('/identity-links', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
