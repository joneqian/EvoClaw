import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { AgentFsGuard, inspectBashCommand } from '../agent/agent-fs-guard.js';

const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const INITIAL_SQL = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');

describe('AgentFsGuard', () => {
  let store: SqliteStore;
  let tmpDir: string;
  let agentsBaseDir: string;
  let realUuid: string;
  let fakeUuid: string;
  let guard: AgentFsGuard;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-fsguard-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    agentsBaseDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentsBaseDir, { recursive: true });

    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.exec(INITIAL_SQL);

    realUuid = crypto.randomUUID();
    // 模仿 typo：把第二段第一个字符 b↔d 互换形成 fakeUuid
    const flipBd = (c: string): string => (c === 'b' ? 'd' : c === 'd' ? 'b' : c);
    const flipped = realUuid.charAt(9) === 'b' || realUuid.charAt(9) === 'd'
      ? realUuid.slice(0, 9) + flipBd(realUuid.charAt(9)) + realUuid.slice(10)
      : realUuid.slice(0, -1) + (realUuid.endsWith('0') ? '1' : '0');
    fakeUuid = flipped;

    store.run(
      'INSERT INTO agents (id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      realUuid, 'TestAgent', 'active', '{}', new Date().toISOString(), new Date().toISOString(),
    );

    guard = new AgentFsGuard(store, agentsBaseDir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when path is outside agentsBaseDir', () => {
    const r = guard.validateWritePath('/tmp/some-other-place/foo.md');
    expect(r.ok).toBe(true);
  });

  it('passes for a known agent uuid', () => {
    const r = guard.validateWritePath(path.join(agentsBaseDir, realUuid, 'workspace', 'foo.md'));
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown (hallucinated) uuid with hint', () => {
    const target = path.join(agentsBaseDir, fakeUuid, 'workspace', 'foo.md');
    const r = guard.validateWritePath(target);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.uuid).toBe(fakeUuid);
    expect(r.reason).toContain('不在 agents 表中');
    expect(r.hint).toMatch(/相对路径|@workspace/);
  });

  it('passes for reserved management dirs (_orphan, by-name)', () => {
    expect(guard.validateWritePath(path.join(agentsBaseDir, '_orphan', 'foo')).ok).toBe(true);
    expect(guard.validateWritePath(path.join(agentsBaseDir, 'by-name', 'TestAgent', 'foo')).ok).toBe(true);
  });

  it('uses TTL cache (no extra DB hits within 50ms)', () => {
    const target = path.join(agentsBaseDir, realUuid, 'workspace', 'foo.md');
    expect(guard.validateWritePath(target).ok).toBe(true);
    // 删掉 agent 后立即再查 → 缓存命中 → 仍 ok
    store.run('DELETE FROM agents WHERE id = ?', realUuid);
    expect(guard.validateWritePath(target).ok).toBe(true);
    // 清缓存后查 → 应当拒绝
    guard.clearCache();
    expect(guard.validateWritePath(target).ok).toBe(false);
  });
});

describe('inspectBashCommand', () => {
  let store: SqliteStore;
  let tmpDir: string;
  let agentsBaseDir: string;
  let realUuid: string;
  let guard: AgentFsGuard;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-fsguard-bash-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    agentsBaseDir = path.join(tmpDir, '.evoclaw-test', 'agents');
    fs.mkdirSync(agentsBaseDir, { recursive: true });

    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.exec(INITIAL_SQL);

    realUuid = crypto.randomUUID();
    store.run(
      'INSERT INTO agents (id, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      realUuid, 'A', 'active', '{}', new Date().toISOString(), new Date().toISOString(),
    );

    guard = new AgentFsGuard(store, agentsBaseDir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes commands with no agents path', () => {
    expect(inspectBashCommand('ls -la', guard, agentsBaseDir).ok).toBe(true);
    expect(inspectBashCommand('echo hello', guard, agentsBaseDir).ok).toBe(true);
  });

  it('passes commands referencing real agent uuid', () => {
    const cmd = `cat /Users/x/.evoclaw-test/agents/${realUuid}/workspace/SOUL.md`;
    expect(inspectBashCommand(cmd, guard, agentsBaseDir).ok).toBe(true);
  });

  it('rejects commands referencing hallucinated uuid', () => {
    const fakeUuid = realUuid.replace(/[0-9a-f]/, (c) => (c === '0' ? '1' : '0'));
    const cmd = `mkdir -p /Users/x/.evoclaw-test/agents/${fakeUuid}/workspace/sub`;
    const r = inspectBashCommand(cmd, guard, agentsBaseDir);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.uuid).toBe(fakeUuid);
  });
});
