#!/usr/bin/env node
// 版本号一致性检查 CLI — CI 中验证 7 处版本号同步。
//
// 用法：
//   node scripts/version-check.mjs    # exit 0 一致 / exit 1 不一致

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheck } from './lib/version-helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const result = runCheck(REPO_ROOT);
for (const line of result.lines) {
  if (result.exitCode === 0) console.log(line);
  else console.error(line);
}
process.exit(result.exitCode);
