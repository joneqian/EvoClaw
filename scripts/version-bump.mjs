#!/usr/bin/env node
// 版本号 bump CLI — 同步根 package.json + 6 处目标文件到统一新版本。
//
// 用法：
//   node scripts/version-bump.mjs patch              # 0.1.0 → 0.1.1
//   node scripts/version-bump.mjs minor              # 0.1.0 → 0.2.0
//   node scripts/version-bump.mjs major              # 0.1.0 → 1.0.0
//   node scripts/version-bump.mjs --set 1.2.3        # 直接设为 1.2.3
//   node scripts/version-bump.mjs --dry-run patch    # 只预览不写入

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpAllAtomic } from './lib/version-helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--set') {
      opts.setVersion = argv[++i];
      if (!opts.setVersion) throw new Error('--set requires a version argument');
    } else if (a === 'patch' || a === 'minor' || a === 'major') {
      opts.type = a;
    } else if (a === '-h' || a === '--help') {
      printUsage();
      process.exit(0);
    } else {
      positional.push(a);
    }
  }
  if (!opts.setVersion && !opts.type) {
    throw new Error('must provide one of: patch | minor | major | --set <version>');
  }
  if (positional.length > 0) {
    throw new Error(`unexpected positional args: ${positional.join(' ')}`);
  }
  return opts;
}

function printUsage() {
  console.log(`Usage:
  node scripts/version-bump.mjs <patch|minor|major>   bump semver part
  node scripts/version-bump.mjs --set <semver>        set absolute version
  node scripts/version-bump.mjs --dry-run <...>       preview only`);
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

  const result = bumpAllAtomic(REPO_ROOT, opts);
  const action = opts.dryRun ? '[DRY-RUN]' : '✅';
  console.log(`${action} ${result.oldVersion} → ${result.newVersion}`);
  if (opts.dryRun) {
    console.log('No files written. Re-run without --dry-run to apply.');
    return;
  }
  for (const p of result.written) {
    console.log(`  • ${path.relative(REPO_ROOT, p)}`);
  }
}

main();
