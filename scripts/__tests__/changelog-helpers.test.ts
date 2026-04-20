import { describe, it, expect } from 'vitest';
import {
  parseCommits,
  classifyCommit,
  groupCommits,
  formatChangelog,
  prependToChangelog,
} from '../lib/changelog-helpers.mjs';

// ─── parseCommits ────────────────────────────────────────────────────────────

// Format: <hash>\x00<subject>\x00<body>\x1e
const rec = (hash: string, subject: string, body = '') =>
  `${hash}\x00${subject}\x00${body}\x1e`;

describe('parseCommits', () => {
  it('解析无 scope 的 feat', () => {
    const [c] = parseCommits(rec('abc1234defg', 'feat: add foo'));
    expect(c.hash).toBe('abc1234');
    expect(c.type).toBe('feat');
    expect(c.scope).toBeNull();
    expect(c.subject).toBe('add foo');
    expect(c.breaking).toBe(false);
  });

  it('解析带 scope 的 fix', () => {
    const [c] = parseCommits(rec('hash000000', 'fix(core): resolve crash'));
    expect(c.type).toBe('fix');
    expect(c.scope).toBe('core');
    expect(c.subject).toBe('resolve crash');
  });

  it('识别 ! 标记的 breaking change', () => {
    const [c] = parseCommits(rec('hash111111', 'feat(api)!: drop v1 endpoint'));
    expect(c.breaking).toBe(true);
    expect(c.scope).toBe('api');
    expect(c.subject).toBe('drop v1 endpoint');
  });

  it('从 body 的 BREAKING CHANGE trailer 识别 breaking', () => {
    const [c] = parseCommits(rec('hash222222', 'feat: redo', 'BREAKING CHANGE: auth changed'));
    expect(c.breaking).toBe(true);
  });

  it('无 conventional 前缀的 subject 归为 other 候选', () => {
    const [c] = parseCommits(rec('hash333333', 'update something random'));
    expect(c.type).toBeNull();
    expect(c.subject).toBe('update something random');
  });

  it('跳过空记录', () => {
    expect(parseCommits('')).toEqual([]);
    expect(parseCommits('\x1e\x1e')).toEqual([]);
  });

  it('解析多条记录', () => {
    const text = rec('aaa1111', 'feat: A') + rec('bbb2222', 'fix: B');
    const commits = parseCommits(text);
    expect(commits).toHaveLength(2);
    expect(commits[0].subject).toBe('A');
    expect(commits[1].subject).toBe('B');
  });

  it('保留多行 body', () => {
    const [c] = parseCommits(rec('hash444444', 'feat: x', 'line 1\nline 2\nline 3'));
    expect(c.body).toBe('line 1\nline 2\nline 3');
  });

  it('scope 支持连字符和中文', () => {
    const [c] = parseCommits(rec('hash555555', 'feat(agent-core): 新增能力'));
    expect(c.scope).toBe('agent-core');
    expect(c.subject).toBe('新增能力');
  });
});

// ─── classifyCommit ──────────────────────────────────────────────────────────

describe('classifyCommit', () => {
  it.each([
    ['feat', 'features'],
    ['fix', 'bugfixes'],
    ['perf', 'performance'],
    ['refactor', 'refactor'],
    ['docs', 'documentation'],
    ['test', 'tests'],
    ['chore', 'chores'],
    ['build', 'chores'],
    ['ci', 'chores'],
    ['style', 'chores'],
    ['revert', 'reverts'],
  ])('%s 映射到 %s', (type, group) => {
    expect(classifyCommit({ type, breaking: false, scope: null, subject: '', hash: '', rawSubject: '', body: '' } as any)).toBe(group);
  });

  it('未知 type 归入 other', () => {
    expect(classifyCommit({ type: 'unknown', breaking: false, scope: null, subject: '', hash: '', rawSubject: '', body: '' } as any)).toBe('other');
  });

  it('null type 归入 other', () => {
    expect(classifyCommit({ type: null, breaking: false, scope: null, subject: '', hash: '', rawSubject: '', body: '' } as any)).toBe('other');
  });
});

// ─── groupCommits ────────────────────────────────────────────────────────────

describe('groupCommits', () => {
  it('按 type 分组', () => {
    const commits = parseCommits(
      rec('a', 'feat: A') + rec('b', 'fix: B') + rec('c', 'feat: C'),
    );
    const groups = groupCommits(commits);
    expect(groups.features).toHaveLength(2);
    expect(groups.bugfixes).toHaveLength(1);
  });

  it('build/ci/chore/style 合并到 chores', () => {
    const commits = parseCommits(
      rec('a', 'chore: A') +
        rec('b', 'ci: B') +
        rec('c', 'build: C') +
        rec('d', 'style: D'),
    );
    const groups = groupCommits(commits);
    expect(groups.chores).toHaveLength(4);
  });
});

// ─── formatChangelog ─────────────────────────────────────────────────────────

describe('formatChangelog', () => {
  it('生成标准版本块', () => {
    const commits = parseCommits(
      rec('abcdef1', 'feat(core): add X') + rec('1234567', 'fix: bug Y'),
    );
    const groups = groupCommits(commits);
    const out = formatChangelog({ version: '0.2.0', date: '2026-04-20', groups });
    expect(out).toContain('## [0.2.0] - 2026-04-20');
    expect(out).toContain('### ✨ Features');
    expect(out).toContain('**core**: add X');
    expect(out).toContain('### 🐛 Bug Fixes');
    expect(out).toContain('bug Y');
  });

  it('按固定顺序输出 group（feat 在 fix 之前）', () => {
    const commits = parseCommits(
      rec('aaa', 'fix: B') + rec('bbb', 'feat: A'),
    );
    const groups = groupCommits(commits);
    const out = formatChangelog({ version: '1.0.0', date: '2026-04-20', groups });
    expect(out.indexOf('Features')).toBeLessThan(out.indexOf('Bug Fixes'));
  });

  it('breaking change 加 ⚠️ 前缀', () => {
    const commits = parseCommits(rec('hash000', 'feat(api)!: drop v1'));
    const out = formatChangelog({ version: '2.0.0', date: '2026-04-20', groups: groupCommits(commits) });
    expect(out).toContain('⚠️');
    expect(out).toContain('drop v1');
  });

  it('空 groups 生成最小骨架', () => {
    const out = formatChangelog({ version: '0.1.0', date: '2026-04-20', groups: {} });
    expect(out).toBe('## [0.1.0] - 2026-04-20\n');
  });

  it('commit 带 7 位短 hash', () => {
    const commits = parseCommits(rec('abcdef1234567', 'feat: X'));
    const out = formatChangelog({ version: '0.2.0', date: '2026-04-20', groups: groupCommits(commits) });
    expect(out).toMatch(/\(abcdef1\)/);
  });
});

// ─── prependToChangelog ──────────────────────────────────────────────────────

describe('prependToChangelog', () => {
  it('空文件生成带 Header 的新 CHANGELOG', () => {
    const out = prependToChangelog('', '## [0.1.0] - 2026-01-01\n\nFoo\n');
    expect(out).toBe('# Changelog\n\n## [0.1.0] - 2026-01-01\n\nFoo\n\n');
  });

  it('已有 Header 的 CHANGELOG 头部插入新版本', () => {
    const existing = '# Changelog\n\n## [0.1.0] - 2026-01-01\n\nfoo\n';
    const newSection = '## [0.2.0] - 2026-02-01\n\nbar\n';
    const out = prependToChangelog(existing, newSection);
    expect(out.indexOf('[0.2.0]')).toBeLessThan(out.indexOf('[0.1.0]'));
    expect(out).toContain('# Changelog');
    expect(out.match(/# Changelog/g)).toHaveLength(1);
  });

  it('保留已有版本内容不变', () => {
    const existing = '# Changelog\n\n## [0.1.0] - 2026-01-01\n\n### ✨ Features\n\n- old feature\n';
    const newSection = '## [0.2.0] - 2026-02-01\n\nnew\n';
    const out = prependToChangelog(existing, newSection);
    expect(out).toContain('- old feature');
  });
});
