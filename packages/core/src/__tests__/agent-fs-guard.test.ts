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

// ─────────────────────────────────────────────────────────────────────────
// P1-A 跟尾：bash 命令访问 workspace RESTRICTED 文件门控（subagent/cron 拦）
// ─────────────────────────────────────────────────────────────────────────

describe('inspectBashRestrictedFiles', () => {
  // workspaceRoot 用临时目录模拟，sessionKey 用字符串
  const wsRoot = '/tmp/test-ws';
  const SUBAGENT = 'agent:abc:local:subagent:t1';
  const CRON = 'agent:abc:cron:job1';
  const MAIN = 'agent:abc:default:direct:';

  it('subagent: cat BOOTSTRAP.md 应被拒绝', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    const r = inspectBashRestrictedFiles('cat BOOTSTRAP.md', SUBAGENT, wsRoot);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toMatch(/BOOTSTRAP\.md/);
  });

  it('subagent: cat ./HEARTBEAT.md 应被拒绝', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    const r = inspectBashRestrictedFiles('cat ./HEARTBEAT.md', SUBAGENT, wsRoot);
    expect(r.ok).toBe(false);
  });

  it('subagent: head -n 100 MEMORY.md 应被拒绝', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    const r = inspectBashRestrictedFiles('head -n 100 MEMORY.md', SUBAGENT, wsRoot);
    expect(r.ok).toBe(false);
  });

  it('subagent: echo "" > BOOTSTRAP.md 应被拒绝（写入也拦）', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    const r = inspectBashRestrictedFiles('echo "" > BOOTSTRAP.md', SUBAGENT, wsRoot);
    expect(r.ok).toBe(false);
  });

  it('subagent: 绝对路径 cat /tmp/test-ws/BOOTSTRAP.md 应被拒绝', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    const r = inspectBashRestrictedFiles(`cat ${wsRoot}/BOOTSTRAP.md`, SUBAGENT, wsRoot);
    expect(r.ok).toBe(false);
  });

  it('subagent: cat sub/BOOTSTRAP.md（子目录同名）应放行', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles('cat sub/BOOTSTRAP.md', SUBAGENT, wsRoot).ok).toBe(true);
    expect(inspectBashRestrictedFiles('cat ./sub/HEARTBEAT.md', SUBAGENT, wsRoot).ok).toBe(true);
  });

  it('subagent: 文件名是 RESTRICTED 子串（如 MYBOOTSTRAP.md）应放行', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles('cat MYBOOTSTRAP.md', SUBAGENT, wsRoot).ok).toBe(true);
    expect(inspectBashRestrictedFiles('cat HEARTBEAT.md.bak', SUBAGENT, wsRoot).ok).toBe(true);
  });

  it('cron: cat BOOTSTRAP.md 应被拒绝', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    const r = inspectBashRestrictedFiles('cat BOOTSTRAP.md', CRON, wsRoot);
    expect(r.ok).toBe(false);
  });

  it('主 session: cat BOOTSTRAP.md 应放行', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles('cat BOOTSTRAP.md', MAIN, wsRoot).ok).toBe(true);
  });

  it('缺 sessionKey 或 缺 workspaceRoot → 不门控', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles('cat BOOTSTRAP.md', undefined, wsRoot).ok).toBe(true);
    expect(inspectBashRestrictedFiles('cat BOOTSTRAP.md', SUBAGENT, undefined).ok).toBe(true);
  });

  it('引号包裹文件名也能识别', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles(`cat 'BOOTSTRAP.md'`, SUBAGENT, wsRoot).ok).toBe(false);
    expect(inspectBashRestrictedFiles(`cat "BOOTSTRAP.md"`, SUBAGENT, wsRoot).ok).toBe(false);
  });

  it('管道 / 复合命令也能识别', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles('cat MEMORY.md | head -10', SUBAGENT, wsRoot).ok).toBe(false);
    expect(inspectBashRestrictedFiles('ls && cat BOOTSTRAP.md', SUBAGENT, wsRoot).ok).toBe(false);
  });

  it('普通命令（无 RESTRICTED 引用）→ 放行', async () => {
    const { inspectBashRestrictedFiles } = await import('../agent/agent-fs-guard.js');
    expect(inspectBashRestrictedFiles('ls -la', SUBAGENT, wsRoot).ok).toBe(true);
    expect(inspectBashRestrictedFiles('cat README.md', SUBAGENT, wsRoot).ok).toBe(true);
    expect(inspectBashRestrictedFiles('cat SOUL.md', SUBAGENT, wsRoot).ok).toBe(true);
  });
});
