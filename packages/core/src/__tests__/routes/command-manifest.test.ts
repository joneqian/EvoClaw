/**
 * M3 T3a 测试：routes/command-manifest.ts
 *
 * - ROUTE_MANIFEST 健康性（path 无重复、基础字段完整）
 * - TOOL_MANIFEST 与原 permission-interceptor.ts 的 TOOL_CATEGORY_MAP 语义一致（snapshot）
 */

import { describe, it, expect } from 'vitest';
import {
  ROUTE_MANIFEST,
  TOOL_MANIFEST,
  TOOL_CATEGORY_MAP,
  getToolCategory,
  type HttpMethod,
} from '../../routes/command-manifest.js';

const LEGAL_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT'];
const LEGAL_PERMISSIONS = new Set([
  'file_read', 'file_write', 'network', 'shell', 'browser', 'mcp', 'skill',
]);

describe('ROUTE_MANIFEST', () => {
  it('所有条目字段基础校验', () => {
    expect(ROUTE_MANIFEST.length).toBeGreaterThanOrEqual(40);
    for (const r of ROUTE_MANIFEST) {
      expect(LEGAL_METHODS).toContain(r.method);
      expect(r.path.startsWith('/')).toBe(true);
      expect(r.description.length).toBeGreaterThan(0);
      expect(r.category.length).toBeGreaterThan(0);
      if (r.requiredPermission) {
        expect(LEGAL_PERMISSIONS.has(r.requiredPermission)).toBe(true);
      }
    }
  });

  it('method + path 组合唯一（无重复登记）', () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const r of ROUTE_MANIFEST) {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) dups.push(key);
      seen.add(key);
    }
    expect(dups).toEqual([]);
  });

  it('包含 M4 / M4.1 新增的关键端点', () => {
    const findBy = (method: HttpMethod, path: string) =>
      ROUTE_MANIFEST.find(r => r.method === method && r.path === path);
    expect(findBy('POST', '/mcp/servers/:name/reconnect')).toBeDefined(); // M4.1
    expect(findBy('GET', '/mcp/prompts')).toBeDefined();                  // M4
    expect(findBy('GET', '/config/warnings')).toBeDefined();              // M4.1
  });

  it('category 分组至少覆盖核心领域', () => {
    const categories = new Set(ROUTE_MANIFEST.map(r => r.category));
    for (const required of ['agent', 'chat', 'config', 'mcp', 'memory', 'provider', 'security', 'skill']) {
      expect(categories.has(required)).toBe(true);
    }
  });
});

describe('TOOL_MANIFEST', () => {
  it('name 唯一且无空字段', () => {
    const names = new Set<string>();
    const dups: string[] = [];
    for (const t of TOOL_MANIFEST) {
      if (names.has(t.name)) dups.push(t.name);
      names.add(t.name);
      expect(t.description.length).toBeGreaterThan(0);
      expect(LEGAL_PERMISSIONS.has(t.category)).toBe(true);
    }
    expect(dups).toEqual([]);
  });

  /**
   * Snapshot: 与 M3-T3a 迁移前 permission-interceptor.ts 内联的 TOOL_CATEGORY_MAP 保持一致。
   * 如果未来新增/删除工具权限映射，需同步更新此期望值，确保 PR 走 review 而非悄悄漂移。
   */
  it('TOOL_CATEGORY_MAP 与 M3-T3a 迁移前的 snapshot 完全一致', () => {
    const SNAPSHOT_BEFORE_T3A: Record<string, string> = {
      write: 'file_write',
      edit: 'file_write',
      apply_patch: 'file_write',
      bash: 'shell',
      shell: 'shell',
      exec_background: 'shell',
      process: 'shell',
      web_search: 'network',
      web_fetch: 'network',
      fetch: 'network',
      http: 'network',
      browse: 'browser',
    };
    // 方向 1: snapshot 里的工具都在 MANIFEST 中，类别一致
    for (const [name, cat] of Object.entries(SNAPSHOT_BEFORE_T3A)) {
      expect(TOOL_CATEGORY_MAP[name]).toBe(cat);
    }
    // 方向 2: MANIFEST 里除 snapshot 之外不该有额外条目（防意外漂移）
    const manifestNames = new Set(Object.keys(TOOL_CATEGORY_MAP));
    const snapshotNames = new Set(Object.keys(SNAPSHOT_BEFORE_T3A));
    for (const n of manifestNames) {
      expect(snapshotNames.has(n), `TOOL_MANIFEST 多出工具 ${n}，请审查或更新 snapshot`).toBe(true);
    }
  });

  it('getToolCategory 未登记工具回落到 skill', () => {
    expect(getToolCategory('totally_unknown_tool')).toBe('skill');
  });

  it('getToolCategory 对登记工具返回正确类别', () => {
    expect(getToolCategory('bash')).toBe('shell');
    expect(getToolCategory('write')).toBe('file_write');
    expect(getToolCategory('web_fetch')).toBe('network');
  });
});
