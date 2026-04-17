import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeCredentialFile } from '../../infrastructure/credential-file.js';

const isPosix = process.platform !== 'win32';

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'evoclaw-perm-test-'));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe('writeCredentialFile', () => {
  it('新建文件权限应为 0o600', () => {
    const file = path.join(workdir, 'sub', 'evo_claw.json');
    writeCredentialFile(file, '{"a":1}');
    expect(existsSync(file)).toBe(true);
    if (isPosix) {
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('父目录权限应为 0o700（递归创建）', () => {
    const file = path.join(workdir, 'level1', 'level2', 'evo_claw.json');
    writeCredentialFile(file, '{}');
    if (isPosix) {
      const mode = statSync(path.dirname(file)).mode & 0o777;
      expect(mode).toBe(0o700);
    }
  });

  it('已存在的 0o644 文件被覆盖后变成 0o600', () => {
    const file = path.join(workdir, 'evo_claw.json');
    writeFileSync(file, '{"old":true}');
    if (isPosix) chmodSync(file, 0o644); // 模拟世界可读

    writeCredentialFile(file, '{"new":true}');
    if (isPosix) {
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('父目录已存在不报错', () => {
    const file = path.join(workdir, 'evo_claw.json');
    expect(() => writeCredentialFile(file, '{}')).not.toThrow();
    expect(() => writeCredentialFile(file, '{"x":1}')).not.toThrow(); // 第二次写入
  });

  it('Windows 平台不应抛错（chmod 失败容忍）', () => {
    // 在所有平台上验证写入完成；Windows 上 chmod 是 no-op
    const file = path.join(workdir, 'win-test.json');
    expect(() => writeCredentialFile(file, '{"ok":true}')).not.toThrow();
    expect(existsSync(file)).toBe(true);
  });
});
