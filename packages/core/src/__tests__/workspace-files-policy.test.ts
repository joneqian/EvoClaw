import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_FILE_LISTS,
  RESTRICTED_FILES_FOR_SUBAGENT,
  selectWorkspaceFiles,
  isWorkspaceFileAccessAllowed,
} from '../agent/workspace-files-policy.js';
import type { SessionKey } from '@evoclaw/shared';

/**
 * Workspace 文件策略测试
 *
 * 这是 P1-A 的核心策略层：
 * 1. 文件清单（ALL/MINIMAL/HEARTBEAT/LIGHT）DRY 化，消除 chat.ts/channel-message-handler.ts 两份 drift
 * 2. RESTRICTED_FILES_FOR_SUBAGENT = subagent/cron 不能读写的文件清单
 *
 * sessionKey 形如：
 * - 主 session：`agent:<id>:default:direct:` 或 `agent:<id>:feishu:group:<peer>`
 * - subagent：`agent:<id>:local:subagent:<taskId>`（sub-agent-spawner.ts:116）
 * - cron：`agent:<id>:cron:<jobId>`（cron-runner.ts:126）
 */

describe('WORKSPACE_FILE_LISTS', () => {
  it('ALL 包含全部 9 个工作区文件 + TODO.json', () => {
    // 修复 chat.ts vs channel-message-handler.ts 的 drift（前者带 TODO.json，后者没有）
    expect(WORKSPACE_FILE_LISTS.ALL).toEqual([
      'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md',
      'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'TODO.json',
    ]);
  });

  it('MINIMAL = 5 个共享文件（subagent/cron 用）', () => {
    expect(WORKSPACE_FILE_LISTS.MINIMAL).toEqual([
      'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md',
    ]);
  });

  it('HEARTBEAT = 心跳清单 + 操作规程', () => {
    // 修复 channel-message-handler.ts 缺 AGENTS.md 的 drift
    expect(WORKSPACE_FILE_LISTS.HEARTBEAT).toEqual(['HEARTBEAT.md', 'AGENTS.md']);
  });

  it('LIGHT = 仅心跳清单', () => {
    expect(WORKSPACE_FILE_LISTS.LIGHT).toEqual(['HEARTBEAT.md']);
  });
});

describe('RESTRICTED_FILES_FOR_SUBAGENT', () => {
  it('包含 BOOTSTRAP / HEARTBEAT / MEMORY 三个文件', () => {
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('BOOTSTRAP.md')).toBe(true);
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('HEARTBEAT.md')).toBe(true);
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('MEMORY.md')).toBe(true);
  });

  it('不限制 SOUL/IDENTITY/AGENTS/TOOLS/USER（subagent 也应能读这些）', () => {
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('SOUL.md')).toBe(false);
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('IDENTITY.md')).toBe(false);
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('AGENTS.md')).toBe(false);
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('TOOLS.md')).toBe(false);
    expect(RESTRICTED_FILES_FOR_SUBAGENT.has('USER.md')).toBe(false);
  });
});

describe('selectWorkspaceFiles', () => {
  const mainSession = 'agent:abc:default:direct:' as SessionKey;
  const subAgentSession = 'agent:abc:local:subagent:t1' as SessionKey;
  const cronSession = 'agent:abc:cron:job1' as SessionKey;
  const heartbeatSession = 'agent:abc:default:direct::heartbeat:p1' as SessionKey;

  it('主 session 默认 → ALL', () => {
    expect(selectWorkspaceFiles(mainSession, {})).toEqual(WORKSPACE_FILE_LISTS.ALL);
  });

  it('isLightContext=true → LIGHT（最高优先级）', () => {
    expect(selectWorkspaceFiles(mainSession, { isHeartbeat: true, isLightContext: true })).toEqual(WORKSPACE_FILE_LISTS.LIGHT);
  });

  it('isHeartbeat=true → HEARTBEAT', () => {
    expect(selectWorkspaceFiles(mainSession, { isHeartbeat: true })).toEqual(WORKSPACE_FILE_LISTS.HEARTBEAT);
  });

  it('subagent session → MINIMAL', () => {
    expect(selectWorkspaceFiles(subAgentSession, {})).toEqual(WORKSPACE_FILE_LISTS.MINIMAL);
  });

  it('cron session → MINIMAL', () => {
    expect(selectWorkspaceFiles(cronSession, {})).toEqual(WORKSPACE_FILE_LISTS.MINIMAL);
  });

  it('heartbeat 标记 session（主 session 派生）→ HEARTBEAT', () => {
    expect(selectWorkspaceFiles(heartbeatSession, {})).toEqual(WORKSPACE_FILE_LISTS.HEARTBEAT);
  });

  it('优先级：lightContext > heartbeat > subagent/cron > ALL', () => {
    // subagent + heartbeat → 仍走 HEARTBEAT 路径（heartbeat 优先，但 subagent 应限制掉 RESTRICTED）
    // 业务现状：subagent 不会有 isHeartbeat，但参数都传 true 时 heartbeat 优先
    expect(selectWorkspaceFiles(subAgentSession, { isHeartbeat: true })).toEqual(WORKSPACE_FILE_LISTS.HEARTBEAT);
  });
});

describe('isWorkspaceFileAccessAllowed', () => {
  const mainSession = 'agent:abc:default:direct:' as SessionKey;
  const subAgentSession = 'agent:abc:local:subagent:t1' as SessionKey;
  const cronSession = 'agent:abc:cron:job1' as SessionKey;

  it('主 session 可访问 RESTRICTED 文件', () => {
    expect(isWorkspaceFileAccessAllowed(mainSession, 'BOOTSTRAP.md')).toBe(true);
    expect(isWorkspaceFileAccessAllowed(mainSession, 'HEARTBEAT.md')).toBe(true);
    expect(isWorkspaceFileAccessAllowed(mainSession, 'MEMORY.md')).toBe(true);
  });

  it('subagent 不能访问 RESTRICTED 文件', () => {
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'BOOTSTRAP.md')).toBe(false);
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'HEARTBEAT.md')).toBe(false);
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'MEMORY.md')).toBe(false);
  });

  it('cron 不能访问 RESTRICTED 文件', () => {
    expect(isWorkspaceFileAccessAllowed(cronSession, 'BOOTSTRAP.md')).toBe(false);
    expect(isWorkspaceFileAccessAllowed(cronSession, 'HEARTBEAT.md')).toBe(false);
    expect(isWorkspaceFileAccessAllowed(cronSession, 'MEMORY.md')).toBe(false);
  });

  it('subagent 可访问非 RESTRICTED 文件（SOUL/IDENTITY/USER 等）', () => {
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'SOUL.md')).toBe(true);
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'IDENTITY.md')).toBe(true);
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'AGENTS.md')).toBe(true);
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'USER.md')).toBe(true);
  });

  it('undefined sessionKey → 通过（内部/管理员调用，不门控）', () => {
    expect(isWorkspaceFileAccessAllowed(undefined, 'BOOTSTRAP.md')).toBe(true);
  });

  it('subagent 试 workspace 子目录 BOOTSTRAP.md（非根） → 通过（仅根目录限制）', () => {
    // 路径策略：仅限制 workspace 根下的 RESTRICTED 文件名，子目录同名文件不限
    // （子目录文件不是核心 onboarding/heartbeat/memory 视图）
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'sub/BOOTSTRAP.md')).toBe(true);
    expect(isWorkspaceFileAccessAllowed(subAgentSession, 'a/b/HEARTBEAT.md')).toBe(true);
  });
});
