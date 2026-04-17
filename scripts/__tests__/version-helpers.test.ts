import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  bumpSemver,
  updateJsonVersion,
  updateCargoVersion,
  readAllVersions,
  checkConsistency,
  bumpAllAtomic,
  runCheck,
  TARGET_FILES,
} from '../lib/version-helpers.mjs';

// ─── bumpSemver ──────────────────────────────────────────────────────────────

describe('bumpSemver', () => {
  it('patch: 0.1.0 → 0.1.1', () => {
    expect(bumpSemver('0.1.0', 'patch')).toBe('0.1.1');
  });
  it('minor: 0.1.0 → 0.2.0', () => {
    expect(bumpSemver('0.1.0', 'minor')).toBe('0.2.0');
  });
  it('major: 0.1.0 → 1.0.0', () => {
    expect(bumpSemver('0.1.0', 'major')).toBe('1.0.0');
  });
  it('patch from 1.2.3 → 1.2.4', () => {
    expect(bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
  });
  it('minor from 1.2.3 → 1.3.0 (resets patch)', () => {
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
  });
  it('major from 1.2.3 → 2.0.0 (resets minor + patch)', () => {
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });
  it('throws on invalid semver string', () => {
    expect(() => bumpSemver('not-a-version', 'patch')).toThrow(/invalid semver/i);
  });
  it('throws on unknown bump type', () => {
    expect(() => bumpSemver('1.0.0', 'foo' as 'patch')).toThrow(/unknown bump type/i);
  });
});

// ─── updateJsonVersion ───────────────────────────────────────────────────────

describe('updateJsonVersion', () => {
  it('replaces version field', () => {
    const input = '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n';
    const out = updateJsonVersion(input, '0.2.0');
    expect(out).toContain('"version": "0.2.0"');
    expect(out).not.toContain('"version": "0.1.0"');
  });
  it('preserves 2-space indent and trailing newline', () => {
    const input = '{\n  "name": "x",\n  "version": "0.1.0"\n}\n';
    const out = updateJsonVersion(input, '0.2.0');
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toContain('  "name": "x"');
  });
  it('preserves all other fields', () => {
    const input = JSON.stringify({ name: 'x', version: '0.1.0', deps: { a: '1' } }, null, 2) + '\n';
    const out = updateJsonVersion(input, '0.2.0');
    const parsed = JSON.parse(out);
    expect(parsed.name).toBe('x');
    expect(parsed.deps).toEqual({ a: '1' });
    expect(parsed.version).toBe('0.2.0');
  });
  it('throws when no version field present', () => {
    const input = '{\n  "name": "x"\n}\n';
    expect(() => updateJsonVersion(input, '0.2.0')).toThrow(/version field not found/i);
  });
});

// ─── updateCargoVersion ──────────────────────────────────────────────────────

describe('updateCargoVersion', () => {
  it('replaces [package] version line', () => {
    const input = `[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ntauri = "2"\n`;
    const out = updateCargoVersion(input, '0.2.0');
    expect(out).toContain('version = "0.2.0"');
  });
  it('does NOT touch versions in [dependencies] / other tables', () => {
    const input = `[package]\nname = "x"\nversion = "0.1.0"\n\n[dependencies]\nfoo = { version = "0.1.0" }\nbar = "0.1.0"\n`;
    const out = updateCargoVersion(input, '0.2.0');
    // package version updated
    expect(out).toMatch(/\[package\][\s\S]*version = "0\.2\.0"/);
    // dependency strings unchanged
    expect(out).toContain('foo = { version = "0.1.0" }');
    expect(out).toContain('bar = "0.1.0"');
  });
  it('preserves comments and surrounding whitespace', () => {
    const input = `# top comment\n[package]\nname = "x"\nversion = "0.1.0" # inline\n`;
    const out = updateCargoVersion(input, '0.2.0');
    expect(out).toContain('# top comment');
    expect(out).toContain('# inline');
  });
  it('throws when [package] section missing', () => {
    const input = `[dependencies]\nfoo = "1"\n`;
    expect(() => updateCargoVersion(input, '0.2.0')).toThrow(/\[package\] section/i);
  });
});

// ─── Filesystem-backed integration tests ─────────────────────────────────────

describe('readAllVersions / checkConsistency / bumpAllAtomic', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'evoclaw-version-test-'));
    seedFakeRepo(workdir, '0.1.0');
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('readAllVersions: returns all 7 paths with version', () => {
    const versions = readAllVersions(workdir);
    expect(versions).toHaveLength(TARGET_FILES.length + 1); // root + 6 targets
    for (const v of versions) {
      expect(v.version).toBe('0.1.0');
    }
  });

  it('checkConsistency: all equal → ok=true', () => {
    const versions = readAllVersions(workdir);
    expect(checkConsistency(versions).ok).toBe(true);
  });

  it('checkConsistency: drift → ok=false with diff list', () => {
    const cargoPath = path.join(workdir, 'apps/desktop/src-tauri/Cargo.toml');
    writeFileSync(cargoPath, readFileSync(cargoPath, 'utf-8').replace('0.1.0', '0.1.2'));
    const versions = readAllVersions(workdir);
    const result = checkConsistency(versions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diffs.length).toBeGreaterThan(0);
    }
  });

  it('bumpAllAtomic dry-run: no files changed', () => {
    bumpAllAtomic(workdir, { type: 'patch', dryRun: true });
    const versions = readAllVersions(workdir);
    for (const v of versions) {
      expect(v.version).toBe('0.1.0');
    }
  });

  it('bumpAllAtomic patch: all 7 files updated', () => {
    bumpAllAtomic(workdir, { type: 'patch', dryRun: false });
    const versions = readAllVersions(workdir);
    for (const v of versions) {
      expect(v.version).toBe('0.1.1');
    }
  });

  it('bumpAllAtomic --set: directly sets version', () => {
    bumpAllAtomic(workdir, { setVersion: '2.5.0', dryRun: false });
    const versions = readAllVersions(workdir);
    for (const v of versions) {
      expect(v.version).toBe('2.5.0');
    }
  });

  it('runCheck: all consistent → exitCode 0', () => {
    const result = runCheck(workdir);
    expect(result.exitCode).toBe(0);
    expect(result.lines.some((l) => l.includes('版本号一致'))).toBe(true);
  });

  it('runCheck: drift → exitCode 1 with diff markers', () => {
    const cargoPath = path.join(workdir, 'apps/desktop/src-tauri/Cargo.toml');
    writeFileSync(cargoPath, readFileSync(cargoPath, 'utf-8').replace('0.1.0', '0.1.2'));
    const result = runCheck(workdir);
    expect(result.exitCode).toBe(1);
    expect(result.lines.some((l) => l.includes('不一致'))).toBe(true);
    expect(result.lines.some((l) => l.includes('✗') && l.includes('Cargo.toml'))).toBe(true);
  });

  it('bumpAllAtomic atomic: any preview failure → no file written', () => {
    // Corrupt Cargo.toml so updateCargoVersion will throw
    const cargoPath = path.join(workdir, 'apps/desktop/src-tauri/Cargo.toml');
    writeFileSync(cargoPath, '# only comment, no [package] section\n');

    expect(() => bumpAllAtomic(workdir, { type: 'patch', dryRun: false })).toThrow();

    // The 4 JSON files MUST still be at 0.1.0 (atomic rollback)
    for (const target of TARGET_FILES.filter((t: { kind: string }) => t.kind === 'json')) {
      const txt = readFileSync(path.join(workdir, target.path), 'utf-8');
      expect(JSON.parse(txt).version).toBe('0.1.0');
    }
    const rootPkg = JSON.parse(readFileSync(path.join(workdir, 'package.json'), 'utf-8'));
    expect(rootPkg.version).toBe('0.1.0');
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedFakeRepo(root: string, version: string): void {
  // Root package.json
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'evoclaw', version, private: true }, null, 2) + '\n');

  // 4 sub package.jsons
  for (const sub of ['apps/desktop', 'packages/core', 'packages/shared']) {
    const dir = path.join(root, sub);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `@evoclaw/${path.basename(sub)}`, version, private: true }, null, 2) + '\n');
  }

  // tauri.conf.json
  const tauriDir = path.join(root, 'apps/desktop/src-tauri');
  mkdirSync(tauriDir, { recursive: true });
  writeFileSync(path.join(tauriDir, 'tauri.conf.json'), JSON.stringify({ productName: 'EvoClaw', version, identifier: 'com.evoclaw.app' }, null, 2) + '\n');

  // Cargo.toml
  writeFileSync(
    path.join(tauriDir, 'Cargo.toml'),
    `[package]\nname = "evoclaw-desktop"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\ntauri = "2"\n`,
  );
}
