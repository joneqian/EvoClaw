// Pure helpers for conventional-commit → CHANGELOG.md 生成。
// Git 子进程交互在 scripts/changelog-generate.mjs CLI wrapper 中。

const GROUP_MAP = {
  feat: 'features',
  feature: 'features',
  fix: 'bugfixes',
  bugfix: 'bugfixes',
  perf: 'performance',
  refactor: 'refactor',
  docs: 'documentation',
  test: 'tests',
  tests: 'tests',
  chore: 'chores',
  build: 'chores',
  ci: 'chores',
  style: 'chores',
  revert: 'reverts',
};

const GROUP_META = {
  features: { title: '✨ Features', order: 1 },
  bugfixes: { title: '🐛 Bug Fixes', order: 2 },
  performance: { title: '⚡ Performance', order: 3 },
  refactor: { title: '♻️ Refactor', order: 4 },
  documentation: { title: '📝 Documentation', order: 5 },
  tests: { title: '🧪 Tests', order: 6 },
  chores: { title: '🔧 Chores', order: 7 },
  reverts: { title: '⏪ Reverts', order: 8 },
  other: { title: '📦 Other', order: 9 },
};

const SUBJECT_RE = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const CHANGELOG_HEADER = '# Changelog\n\n';

/**
 * 解析 git log --format="%H%x00%s%x00%b%x1e" 的输出。
 * @param {string} gitLogText
 * @returns {Array}
 */
export function parseCommits(gitLogText) {
  if (!gitLogText) return [];
  const records = gitLogText.split('\x1e').filter((r) => r.trim());
  const commits = [];
  for (const rec of records) {
    const [hashRaw, subject, body = ''] = rec.replace(/^\n+/, '').split('\x00');
    if (!hashRaw || !subject) continue;
    const trimmedBody = body.trim();
    const match = subject.match(SUBJECT_RE);
    const commit = {
      hash: hashRaw.substring(0, 7),
      fullHash: hashRaw,
      rawSubject: subject,
      body: trimmedBody,
      type: null,
      scope: null,
      subject,
      breaking: false,
    };
    if (match) {
      const [, type, scope, breaking, rest] = match;
      commit.type = type.toLowerCase();
      commit.scope = scope || null;
      commit.breaking = Boolean(breaking);
      commit.subject = rest;
    }
    if (!commit.breaking && /^BREAKING[-\s]CHANGE:/im.test(trimmedBody)) {
      commit.breaking = true;
    }
    commits.push(commit);
  }
  return commits;
}

/**
 * @param {{ type: string|null }} commit
 * @returns {string} group 名（features/bugfixes/.../other）
 */
export function classifyCommit(commit) {
  if (commit.type && GROUP_MAP[commit.type]) {
    return GROUP_MAP[commit.type];
  }
  return 'other';
}

/**
 * @param {Array} commits
 * @returns {Record<string, Array>}
 */
export function groupCommits(commits) {
  const groups = {};
  for (const commit of commits) {
    const name = classifyCommit(commit);
    if (!groups[name]) groups[name] = [];
    groups[name].push(commit);
  }
  return groups;
}

function formatCommitLine(commit) {
  const parts = [];
  if (commit.breaking) parts.push('⚠️');
  if (commit.scope) parts.push(`**${commit.scope}**:`);
  parts.push(commit.subject);
  parts.push(`(${commit.hash})`);
  return `- ${parts.join(' ')}`;
}

/**
 * @param {{ version: string, date: string, groups: Record<string, Array> }} opts
 * @returns {string}
 */
export function formatChangelog({ version, date, groups }) {
  const lines = [`## [${version}] - ${date}`, ''];
  const groupNames = Object.keys(groups).sort(
    (a, b) => (GROUP_META[a]?.order ?? 99) - (GROUP_META[b]?.order ?? 99),
  );
  let hasAnyContent = false;
  for (const name of groupNames) {
    const commits = groups[name];
    if (!commits || commits.length === 0) continue;
    hasAnyContent = true;
    const meta = GROUP_META[name] ?? { title: name };
    lines.push(`### ${meta.title}`);
    lines.push('');
    for (const c of commits) {
      lines.push(formatCommitLine(c));
    }
    lines.push('');
  }
  if (!hasAnyContent) {
    return `${lines[0]}\n`;
  }
  return lines.join('\n');
}

/**
 * 将新 section 插到已有 CHANGELOG 的 Header 后（版本倒序）。
 * @param {string} existing
 * @param {string} newSection
 * @returns {string}
 */
export function prependToChangelog(existing, newSection) {
  const normalizedNew = newSection.endsWith('\n') ? newSection : `${newSection}\n`;
  if (!existing || !existing.trim()) {
    return `${CHANGELOG_HEADER}${normalizedNew}\n`;
  }
  if (existing.startsWith('# Changelog')) {
    const bodyStart = existing.indexOf('\n\n');
    const body = bodyStart !== -1 ? existing.substring(bodyStart + 2) : '';
    return `${CHANGELOG_HEADER}${normalizedNew}\n${body}`;
  }
  return `${CHANGELOG_HEADER}${normalizedNew}\n${existing}`;
}

export const GIT_LOG_FORMAT = '%H%x00%s%x00%b%x1e';

export function todayISO() {
  return new Date().toISOString().substring(0, 10);
}
