/**
 * Layer 1 + Layer 2 测试：builtin tools 的 workspace-relative 路径解析 + AgentFsGuard 兜底
 *
 * 验证场景：
 * - "foo.md" → 落在 workspaceRoot/foo.md
 * - "@workspace/sub/bar.md" → 落在 workspaceRoot/sub/bar.md
 * - 域外绝对路径透传
 * - agentsBaseDir 下的 hallucinate UUID 路径被 fsGuard 拒绝
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { _testing, createBuiltinTools } from '../../agent/kernel/builtin-tools.js';
import { AgentFsGuard } from '../../agent/agent-fs-guard.js';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';

const { resolveAgentPath, FileStateCache, createWriteTool, createReadTool, createLsTool } = _testing;

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const INITIAL_SQL = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');

describe('resolveAgentPath', () => {
  const ws = '/tmp/agents/abc/workspace';

  it('treats bare names as workspace-relative', () => {
    expect(resolveAgentPath('foo.md', ws)).toBe('/tmp/agents/abc/workspace/foo.md');
    expect(resolveAgentPath('sub/bar.md', ws)).toBe('/tmp/agents/abc/workspace/sub/bar.md');
  });

  it('expands @workspace prefix', () => {
    expect(resolveAgentPath('@workspace/foo.md', ws)).toBe('/tmp/agents/abc/workspace/foo.md');
    expect(resolveAgentPath('@workspace', ws)).toBe(ws);
  });

  it('passes absolute paths through', () => {
    expect(resolveAgentPath('/etc/hosts', ws)).toBe('/etc/hosts');
    expect(resolveAgentPath('/tmp/foo.md', ws)).toBe('/tmp/foo.md');
  });

  it('expands ~/ to home', () => {
    expect(resolveAgentPath('~/notes.md', ws)).toBe(path.join(os.homedir(), 'notes.md'));
  });

  it('without workspaceRoot, falls back to cwd-relative', () => {
    const result = resolveAgentPath('foo.md', undefined);
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe('write tool with workspaceRoot', () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let cache: InstanceType<typeof FileStateCache>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-ws-rel-'));
    workspaceRoot = path.join(tmpDir, 'agents', crypto.randomUUID(), 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    cache = new FileStateCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes relative path into workspace', async () => {
    const tool = createWriteTool(cache, workspaceRoot);
    const result = await tool.call({ file_path: 'foo.md', content: 'hello' });
    expect(result.isError).toBeFalsy();
    const expected = path.join(workspaceRoot, 'foo.md');
    expect(fs.existsSync(expected)).toBe(true);
    expect(fs.readFileSync(expected, 'utf-8')).toBe('hello');
  });

  it('writes @workspace/sub path', async () => {
    const tool = createWriteTool(cache, workspaceRoot);
    const result = await tool.call({ file_path: '@workspace/sub/bar.md', content: 'world' });
    expect(result.isError).toBeFalsy();
    const expected = path.join(workspaceRoot, 'sub', 'bar.md');
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('absolute path outside agentsBaseDir is allowed without fsGuard', async () => {
    const tool = createWriteTool(cache, workspaceRoot);
    const target = path.join(tmpDir, 'outside.md');
    const result = await tool.call({ file_path: target, content: 'ok' });
    expect(result.isError).toBeFalsy();
    expect(fs.existsSync(target)).toBe(true);
  });
});

describe('write tool with fsGuard (Layer 2)', () => {
  let tmpDir: string;
  let agentsBaseDir: string;
  let workspaceRoot: string;
  let realUuid: string;
  let store: SqliteStore;
  let guard: AgentFsGuard;
  let cache: InstanceType<typeof FileStateCache>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-guard-'));
    agentsBaseDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsBaseDir, { recursive: true });
    realUuid = crypto.randomUUID();
    workspaceRoot = path.join(agentsBaseDir, realUuid, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    store = new SqliteStore(path.join(tmpDir, 't.db'));
    store.exec(INITIAL_SQL);
    store.run(
      'INSERT INTO agents (id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      realUuid, 'A', 'active', '{}', new Date().toISOString(), new Date().toISOString(),
    );
    guard = new AgentFsGuard(store, agentsBaseDir);
    cache = new FileStateCache();
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows writes to the real agent workspace via absolute path', async () => {
    const tool = createWriteTool(cache, workspaceRoot, guard);
    const target = path.join(agentsBaseDir, realUuid, 'workspace', 'foo.md');
    const result = await tool.call({ file_path: target, content: 'ok' });
    expect(result.isError).toBeFalsy();
    expect(fs.existsSync(target)).toBe(true);
  });

  it('rejects writes to a hallucinated UUID and gives a self-correction hint', async () => {
    const tool = createWriteTool(cache, workspaceRoot, guard);
    // 模拟 b↔d hallucinate
    const fakeUuid = realUuid.replace(/[0-9a-f]/, (c) => (c === '0' ? '1' : '0'));
    const target = path.join(agentsBaseDir, fakeUuid, 'workspace', 'foo.md');
    const result = await tool.call({ file_path: target, content: 'oops' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain(fakeUuid);
    expect(result.content).toMatch(/相对路径|@workspace/);
    // 关键：磁盘上**不应**出现影子目录
    expect(fs.existsSync(path.join(agentsBaseDir, fakeUuid))).toBe(false);
  });

  it('still routes relative paths into the correct workspace under guard', async () => {
    const tool = createWriteTool(cache, workspaceRoot, guard);
    const result = await tool.call({ file_path: 'note.md', content: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(fs.existsSync(path.join(workspaceRoot, 'note.md'))).toBe(true);
  });
});

describe('ls/read tools default to workspace', () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-ls-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'a.md'), 'a');
    fs.writeFileSync(path.join(workspaceRoot, 'b.md'), 'b');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ls without path lists workspace contents', async () => {
    const tool = createLsTool(workspaceRoot);
    const result = await tool.call({});
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('a.md');
    expect(result.content).toContain('b.md');
  });

  it('read with relative path resolves to workspace', async () => {
    const tool = createReadTool(128_000, new FileStateCache(), workspaceRoot);
    const result = await tool.call({ file_path: 'a.md' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('a');
  });
});

describe('createBuiltinTools opts wiring', () => {
  it('passes workspaceRoot down to all 6 tools (smoke)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-builtin-opts-'));
    try {
      const tools = createBuiltinTools(128_000, undefined, { workspaceRoot: tmp });
      const writeTool = tools.find(t => t.name === 'write')!;
      const readTool = tools.find(t => t.name === 'read')!;
      await writeTool.call({ file_path: 'x.md', content: 'y' });
      expect(fs.existsSync(path.join(tmp, 'x.md'))).toBe(true);
      const r = await readTool.call({ file_path: 'x.md' });
      expect(r.content).toContain('y');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
