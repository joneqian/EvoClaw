/**
 * Git 上下文测试
 */

import { describe, it, expect } from 'vitest';
import { getGitContext, formatGitContext } from '../../infrastructure/git-context.js';

describe('GitContext', () => {
  it('在 EvoClaw 仓库中应返回有效的 Git 信息', () => {
    const ctx = getGitContext();
    // 当前在 EvoClaw 仓库中运行测试
    expect(ctx.branch).toBeTruthy();
    expect(ctx.userName).toBeTruthy();
    expect(ctx.status).toBeDefined(); // 可能为空字符串
  });

  it('branch 应为字符串', () => {
    const ctx = getGitContext();
    expect(typeof ctx.branch).toBe('string');
  });

  it('recentCommits 应包含 commit hash', () => {
    const ctx = getGitContext();
    if (ctx.recentCommits) {
      // commit hash 至少 7 个字符
      expect(ctx.recentCommits).toMatch(/^[0-9a-f]{7,}/m);
    }
  });

  it('status 不应超过 2000 字符', () => {
    const ctx = getGitContext();
    if (ctx.status) {
      expect(ctx.status.length).toBeLessThanOrEqual(2100); // 含截断标记
    }
  });

  it('非 git 目录应返回全 null', () => {
    const ctx = getGitContext('/tmp');
    expect(ctx.branch).toBeNull();
    expect(ctx.status).toBeNull();
  });

  it('formatGitContext 应返回可读文本', () => {
    const ctx = getGitContext();
    const formatted = formatGitContext(ctx);
    expect(formatted).toBeTruthy();
    expect(formatted).toContain('Git branch:');
  });

  it('formatGitContext 对空 context 应返回 null', () => {
    const empty = { branch: null, defaultBranch: null, userName: null, status: null, recentCommits: null };
    expect(formatGitContext(empty)).toBeNull();
  });
});
