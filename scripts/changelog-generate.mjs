#!/usr/bin/env node
// changelog-generate.mjs — 从 conventional commits 自动生成 CHANGELOG.md 新版本段落。
//
// 用法:
//   node scripts/changelog-generate.mjs                              # 从最近 tag 到 HEAD，版本读 package.json
//   node scripts/changelog-generate.mjs --version 0.2.0              # 显式指定版本号
//   node scripts/changelog-generate.mjs --from v0.1.0 --to HEAD      # 显式指定区间
//   node scripts/changelog-generate.mjs --dry-run                    # 预览，不写文件
//   node scripts/changelog-generate.mjs --stdout                     # 输出到 stdout 不落盘

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCommits,
  groupCommits,
  formatChangelog,
  prependToChangelog,
  GIT_LOG_FORMAT,
  todayISO,
} from './lib/changelog-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(REPO_ROOT, 'CHANGELOG.md');
const ROOT_PKG_PATH = path.join(REPO_ROOT, 'package.json');

function parseArgs(argv) {
  const opts = { dryRun: false, stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--stdout') opts.stdout = true;
    else if (a === '--version') opts.version = argv[++i];
    else if (a === '--from') opts.from = argv[++i];
    else if (a === '--to') opts.to = argv[++i];
    else if (a === '--date') opts.date = argv[++i];
    else if (a === '-h' || a === '--help') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  return opts;
}

function printUsage() {
  console.log(`Usage:
  node scripts/changelog-generate.mjs [options]

Options:
  --version <semver>   Target version (default: read from package.json)
  --from <ref>         Base ref (default: latest v* tag, or repo start if none)
  --to <ref>           Target ref (default: HEAD)
  --date <YYYY-MM-DD>  Release date (default: today)
  --dry-run            Preview without writing
  --stdout             Print generated section to stdout (skip CHANGELOG.md write)
`);
}

function readPackageVersion() {
  const pkg = JSON.parse(readFileSync(ROOT_PKG_PATH, 'utf-8'));
  return pkg.version;
}

function getLatestTag() {
  try {
    const out = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch {
    return null;
  }
}

function getGitLog(from, to) {
  const range = from ? `${from}..${to}` : to;
  const out = execFileSync(
    'git',
    ['log', range, '--no-merges', `--format=${GIT_LOG_FORMAT}`],
    { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 },
  );
  return out;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    printUsage();
    process.exit(2);
  }

  const version = opts.version || readPackageVersion();
  const date = opts.date || todayISO();
  const from = opts.from || getLatestTag() || null;
  const to = opts.to || 'HEAD';

  const gitLogText = getGitLog(from, to);
  const commits = parseCommits(gitLogText);
  const groups = groupCommits(commits);
  const section = formatChangelog({ version, date, groups });

  if (opts.stdout) {
    process.stdout.write(section);
    return;
  }

  const existing = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, 'utf-8') : '';
  const updated = prependToChangelog(existing, section);

  console.log(`📝 CHANGELOG 生成: v${version} (${date})`);
  console.log(`   区间: ${from ? from : 'repo start'} → ${to}`);
  console.log(`   commits: ${commits.length} 条，分组: ${Object.keys(groups).join(', ') || '(无)'}`);

  if (opts.dryRun) {
    console.log(`\n[DRY-RUN] 不写入文件。新段落预览:\n`);
    console.log(section);
    return;
  }

  writeFileSync(CHANGELOG_PATH, updated, 'utf-8');
  console.log(`✅ 已写入 ${path.relative(REPO_ROOT, CHANGELOG_PATH)}`);
}

main();
