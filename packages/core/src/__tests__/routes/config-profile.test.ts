/**
 * M6 T2b: /config/profile/* 路由端到端
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../../infrastructure/config-manager.js';
import { createConfigRoutes } from '../../routes/config.js';

describe('M6 T2b — /config/profile/* 路由', () => {
  let configDir: string;
  let cm: ConfigManager;
  let app: ReturnType<typeof createConfigRoutes>;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-routes-'));
    cm = new ConfigManager(undefined, { configDir });
    app = createConfigRoutes(cm);
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('GET /profiles 返回 current + profiles 列表', async () => {
    const res = await app.request('/profiles');
    expect(res.status).toBe(200);
    const data = await res.json() as { current: string; profiles: string[] };
    expect(data.current).toBe('default');
    expect(data.profiles).toEqual(['default']);
  });

  it('POST /profile/create 创建新 profile', async () => {
    const res = await app.request('/profile/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'work' }),
    });
    expect(res.status).toBe(200);
    const after = await (await app.request('/profiles')).json() as { profiles: string[] };
    expect(after.profiles.sort()).toEqual(['default', 'work']);
  });

  it('POST /profile/create 名称冲突返回 400', async () => {
    const res = await app.request('/profile/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'default' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /profile/switch 切换 active profile', async () => {
    await app.request('/profile/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'work' }),
    });
    const res = await app.request('/profile/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'work' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { current: string };
    expect(data.current).toBe('work');
    expect(cm.getCurrentProfile()).toBe('work');
  });

  it('POST /profile/switch 到不存在 profile 返回 400', async () => {
    const res = await app.request('/profile/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ghost' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /profile/:name 删除 profile', async () => {
    await app.request('/profile/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'work' }),
    });
    const res = await app.request('/profile/work', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const after = await (await app.request('/profiles')).json() as { profiles: string[] };
    expect(after.profiles).toEqual(['default']);
  });

  it('DELETE /profile/default 返回 400（不能删）', async () => {
    const res = await app.request('/profile/default', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
