// 版本号管理纯函数库 — 供 version-bump.mjs / version-check.mjs / 测试共享

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 受管理的版本号目标文件（不含根 package.json） */
export const TARGET_FILES = [
  { path: 'apps/desktop/package.json', kind: 'json' },
  { path: 'packages/core/package.json', kind: 'json' },
  { path: 'packages/shared/package.json', kind: 'json' },
  { path: 'apps/desktop/src-tauri/tauri.conf.json', kind: 'json' },
  { path: 'apps/desktop/src-tauri/Cargo.toml', kind: 'cargo' },
];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * 计算下一个 semver。
 * @param {string} current
 * @param {'patch'|'minor'|'major'} type
 * @returns {string}
 */
export function bumpSemver(current, type) {
  const m = SEMVER_RE.exec(current);
  if (!m) throw new Error(`invalid semver: ${current}`);
  const [, maj, min, pat] = m;
  const major = Number(maj), minor = Number(min), patch = Number(pat);
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'major') return `${major + 1}.0.0`;
  throw new Error(`unknown bump type: ${type}`);
}

/**
 * 替换 JSON 中的 version 字段，保留 2-space 缩进 + 行尾换行。
 * @param {string} text
 * @param {string} newVersion
 * @returns {string}
 */
export function updateJsonVersion(text, newVersion) {
  const obj = JSON.parse(text);
  if (typeof obj.version !== 'string') {
    throw new Error('version field not found');
  }
  obj.version = newVersion;
  const trailingNewline = text.endsWith('\n') ? '\n' : '';
  return JSON.stringify(obj, null, 2) + trailingNewline;
}

/**
 * 替换 Cargo.toml 中 [package].version。
 * 严格只动 [package] 段下、第一个出现在下一个 [section] 之前的 `version = "..."`。
 * 不碰 [dependencies] 等其它表内的 version 字段。
 * @param {string} text
 * @param {string} newVersion
 * @returns {string}
 */
export function updateCargoVersion(text, newVersion) {
  const lines = text.split('\n');
  let inPackage = false;
  let foundIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('[')) {
      inPackage = trimmed === '[package]';
      continue;
    }
    if (inPackage && /^version\s*=\s*"[^"]+"/.test(trimmed)) {
      foundIdx = i;
      break;
    }
  }
  if (foundIdx === -1) {
    throw new Error('[package] section with version not found');
  }
  lines[foundIdx] = lines[foundIdx].replace(/version\s*=\s*"[^"]+"/, `version = "${newVersion}"`);
  return lines.join('\n');
}

/**
 * 读取根 + 6 处目标文件的版本号。
 * @param {string} root
 * @returns {Array<{path: string, version: string}>}
 */
export function readAllVersions(root) {
  const out = [];
  out.push({ path: 'package.json', version: readJsonVersion(path.join(root, 'package.json')) });
  for (const t of TARGET_FILES) {
    const full = path.join(root, t.path);
    if (t.kind === 'json') out.push({ path: t.path, version: readJsonVersion(full) });
    else out.push({ path: t.path, version: readCargoVersion(full) });
  }
  return out;
}

function readJsonVersion(file) {
  const obj = JSON.parse(readFileSync(file, 'utf-8'));
  return String(obj.version ?? '');
}

function readCargoVersion(file) {
  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  let inPackage = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      inPackage = trimmed === '[package]';
      continue;
    }
    if (inPackage) {
      const m = /^version\s*=\s*"([^"]+)"/.exec(trimmed);
      if (m) return m[1];
    }
  }
  return '';
}

/**
 * 渲染版本号一致性检查的人类可读报告。
 * @param {string} root
 * @returns {{exitCode: number, lines: string[]}}
 */
export function runCheck(root) {
  const versions = readAllVersions(root);
  const result = checkConsistency(versions);
  if (result.ok) {
    return {
      exitCode: 0,
      lines: [
        `✅ 版本号一致：${versions[0].version}`,
        ...versions.map((v) => `  • ${v.path}: ${v.version}`),
      ],
    };
  }
  return {
    exitCode: 1,
    lines: [
      `❌ 版本号不一致（参考根 package.json 为 ${result.ref}）`,
      ...versions.map((v) => `  ${v.version === result.ref ? '✓' : '✗'} ${v.path}: ${v.version}`),
      '',
      '请运行 pnpm version:bump --set <version> 同步全部文件。',
    ],
  };
}

/**
 * 检查所有版本号是否一致。
 * @param {Array<{path: string, version: string}>} versions
 * @returns {{ok: true} | {ok: false, ref: string, diffs: Array<{path: string, version: string}>}}
 */
export function checkConsistency(versions) {
  if (versions.length === 0) return { ok: true };
  const ref = versions[0].version;
  const diffs = versions.filter((v) => v.version !== ref);
  if (diffs.length === 0) return { ok: true };
  return { ok: false, ref, diffs };
}

/**
 * 原子地把所有版本号 bump 到新值。
 * 先全部读取 + 计算新文本，全部成功才写入；任一异常 → 不写任何文件。
 * @param {string} root
 * @param {{type?: 'patch'|'minor'|'major', setVersion?: string, dryRun?: boolean}} opts
 * @returns {{oldVersion: string, newVersion: string, written: string[]}}
 */
export function bumpAllAtomic(root, opts) {
  const rootPkgPath = path.join(root, 'package.json');
  const rootText = readFileSync(rootPkgPath, 'utf-8');
  const oldVersion = JSON.parse(rootText).version;
  if (typeof oldVersion !== 'string') throw new Error('root package.json missing version');

  let newVersion;
  if (opts.setVersion) {
    if (!SEMVER_RE.test(opts.setVersion)) throw new Error(`--set requires valid semver, got: ${opts.setVersion}`);
    newVersion = opts.setVersion;
  } else if (opts.type) {
    newVersion = bumpSemver(oldVersion, opts.type);
  } else {
    throw new Error('must provide either type or setVersion');
  }

  // ─── Phase 1: 全部计算新文本（任一失败 → throw，不写任何文件）───
  const plan = [{ path: rootPkgPath, newText: updateJsonVersion(rootText, newVersion) }];
  for (const t of TARGET_FILES) {
    const full = path.join(root, t.path);
    const text = readFileSync(full, 'utf-8');
    const newText = t.kind === 'json' ? updateJsonVersion(text, newVersion) : updateCargoVersion(text, newVersion);
    plan.push({ path: full, newText });
  }

  // ─── Phase 2: dry-run 直接返回 ───
  if (opts.dryRun) {
    return { oldVersion, newVersion, written: [] };
  }

  // ─── Phase 3: 真实写入 ───
  const written = [];
  for (const step of plan) {
    writeFileSync(step.path, step.newText);
    written.push(step.path);
  }
  return { oldVersion, newVersion, written };
}
