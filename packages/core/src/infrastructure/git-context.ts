/**
 * Git 上下文采集 — 注入系统提示词的环境信息
 *
 * 参考 Claude Code context.ts::getSystemContext():
 * - 当前分支、默认分支、用户名
 * - git status 输出（截断 2000 字符）
 * - 最近 5 条 commit
 */

import { execSync } from 'node:child_process';
import { which } from './runtime.js';
import { createLogger } from './logger.js';

const log = createLogger('git-context');

/** Git 状态截断限制 */
const STATUS_MAX_CHARS = 2_000;

/** 最近 commit 数量 */
const RECENT_COMMITS_COUNT = 5;

/** Git 命令执行超时 */
const GIT_TIMEOUT_MS = 5_000;

export interface GitContext {
  /** 当前分支名 */
  branch: string | null;
  /** 默认分支名 (main/master) */
  defaultBranch: string | null;
  /** Git 用户名 */
  userName: string | null;
  /** git status 输出（截断） */
  status: string | null;
  /** 最近 N 条 commit（单行格式） */
  recentCommits: string | null;
}

/** 安全执行 git 命令 */
function gitExec(args: string, cwd?: string): string | null {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      timeout: GIT_TIMEOUT_MS,
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 采集 Git 上下文信息
 *
 * 如果不在 Git 仓库中或 git 命令不可用，所有字段返回 null。
 *
 * @param cwd 工作目录（默认 process.cwd()）
 */
export function getGitContext(cwd?: string): GitContext {
  const empty: GitContext = { branch: null, defaultBranch: null, userName: null, status: null, recentCommits: null };

  // 检查 git 是否可用
  if (!which('git')) {
    return empty;
  }

  // 检查是否在 git 仓库中
  const isRepo = gitExec('rev-parse --is-inside-work-tree', cwd);
  if (isRepo !== 'true') {
    return empty;
  }

  const branch = gitExec('rev-parse --abbrev-ref HEAD', cwd);
  const userName = gitExec('config user.name', cwd);

  // 默认分支检测
  let defaultBranch = gitExec('symbolic-ref refs/remotes/origin/HEAD --short', cwd);
  if (defaultBranch) {
    defaultBranch = defaultBranch.replace(/^origin\//, '');
  } else {
    // 回退: 检查 main 或 master 是否存在
    const hasMain = gitExec('rev-parse --verify main', cwd);
    const hasMaster = gitExec('rev-parse --verify master', cwd);
    defaultBranch = hasMain ? 'main' : hasMaster ? 'master' : null;
  }

  // git status（截断）
  let status = gitExec('status --short', cwd);
  if (status && status.length > STATUS_MAX_CHARS) {
    status = status.slice(0, STATUS_MAX_CHARS) + '\n... [截断]';
  }

  // 最近 commit
  const recentCommits = gitExec(
    `log --oneline -${RECENT_COMMITS_COUNT} --no-decorate`,
    cwd,
  );

  log.info(`Git 上下文: branch=${branch}, defaultBranch=${defaultBranch}, status=${status?.split('\n').length ?? 0} 行`);

  return { branch, defaultBranch, userName, status, recentCommits };
}

/**
 * 将 GitContext 格式化为可读文本（注入 system prompt）
 */
export function formatGitContext(ctx: GitContext): string | null {
  if (!ctx.branch) return null;

  const lines: string[] = [];
  lines.push(`Git branch: ${ctx.branch}`);
  if (ctx.defaultBranch) lines.push(`Default branch: ${ctx.defaultBranch}`);
  if (ctx.userName) lines.push(`Git user: ${ctx.userName}`);
  if (ctx.status) lines.push(`\nStatus:\n${ctx.status}`);
  if (ctx.recentCommits) lines.push(`\nRecent commits:\n${ctx.recentCommits}`);

  return lines.join('\n');
}
