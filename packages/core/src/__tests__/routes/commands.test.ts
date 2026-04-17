/**
 * M3 T3b 测试：GET /commands + GET /openapi.json
 */

import { describe, it, expect } from 'vitest';
import { createCommandsRoutes } from '../../routes/commands.js';
import { createOpenApiRoutes, buildOpenApiDocument } from '../../routes/openapi.js';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import type { ChannelCommand } from '../../channel/command/types.js';

describe('GET /commands', () => {
  it('返回 { routes, tools, channelCommands } 三段，routes 非空', async () => {
    const app = createCommandsRoutes();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      routes: unknown[];
      tools: unknown[];
      channelCommands: unknown[];
    };
    expect(Array.isArray(body.routes)).toBe(true);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(Array.isArray(body.channelCommands)).toBe(true);
    expect(body.routes.length).toBeGreaterThanOrEqual(40);
    expect(body.tools.length).toBeGreaterThan(0);
    // 默认无 channelCommandRegistry → channelCommands 为空数组
    expect(body.channelCommands).toEqual([]);
  });

  it('带 channelCommandRegistry → channelCommands 映射出 name/description', async () => {
    const registry = new CommandRegistry<ChannelCommand>();
    const fakeCmd: ChannelCommand = {
      name: 'echo',
      aliases: ['e'],
      description: 'echo 消息',
      execute: async () => ({ handled: true, response: '' }),
    };
    registry.register(fakeCmd);

    const app = createCommandsRoutes(registry);
    const res = await app.request('/');
    const body = await res.json() as {
      channelCommands: Array<{ name: string; aliases?: string[]; description: string; category?: string }>;
    };
    expect(body.channelCommands.length).toBe(1);
    expect(body.channelCommands[0].name).toBe('echo');
    expect(body.channelCommands[0].aliases).toEqual(['e']);
    expect(body.channelCommands[0].description).toBe('echo 消息');
  });
});

describe('GET /openapi.json', () => {
  it('返回合法 OpenAPI 3.0 JSON 结构', async () => {
    const app = createOpenApiRoutes();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const doc = await res.json() as {
      openapi: string;
      info: { title: string; version: string; description: string };
      paths: Record<string, Record<string, unknown>>;
    };
    expect(doc.openapi).toBe('3.0.0');
    expect(doc.info.title).toBe('EvoClaw Sidecar API');
    expect(typeof doc.paths).toBe('object');
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(40);
  });

  it('path 参数 Hono `/agents/:id` 正确转换为 OpenAPI `/agents/{id}`', () => {
    const doc = buildOpenApiDocument([
      { method: 'GET', path: '/agents/:id', category: 'agent', description: 'x', since: 'M0' },
    ]);
    expect(doc.paths['/agents/{id}']).toBeDefined();
    expect(doc.paths['/agents/{id}'].get?.summary).toBe('x');
    expect(doc.paths['/agents/{id}'].get?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('无 path 参数时 parameters 字段不出现', () => {
    const doc = buildOpenApiDocument([
      { method: 'GET', path: '/health', category: 'system', description: 'h', since: 'M0' },
    ]);
    expect(doc.paths['/health'].get?.parameters).toBeUndefined();
  });

  it('同路径不同 method 合并在同一 PathItem', () => {
    const doc = buildOpenApiDocument([
      { method: 'GET', path: '/x', category: 'c', description: 'get-x', since: 'M0' },
      { method: 'DELETE', path: '/x', category: 'c', description: 'del-x', since: 'M0' },
    ]);
    const item = doc.paths['/x'];
    expect(item.get?.summary).toBe('get-x');
    expect(item.delete?.summary).toBe('del-x');
  });

  it('category 被塞到 tags 中', () => {
    const doc = buildOpenApiDocument([
      { method: 'GET', path: '/foo', category: 'agent', description: 'f', since: 'M0' },
    ]);
    expect(doc.paths['/foo'].get?.tags).toEqual(['agent']);
  });
});
