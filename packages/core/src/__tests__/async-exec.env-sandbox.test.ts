/**
 * M8 async-exec env sandbox — 集成测试
 *
 * 验证 bash 子进程不再继承敏感凭据。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { asyncExec } from '../infrastructure/async-exec.js';

const SENSITIVE_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DATABASE_PASSWORD'];
const originalValues: Record<string, string | undefined> = {};

// 用 process.env 临时注入敏感变量
for (const k of SENSITIVE_KEYS) {
  originalValues[k] = process.env[k];
  process.env[k] = 'FAKE_LEAK_VALUE';
}
process.env.MY_SAFE_VAR = 'safe-value';

afterAll(() => {
  for (const k of SENSITIVE_KEYS) {
    if (originalValues[k] === undefined) delete process.env[k];
    else process.env[k] = originalValues[k];
  }
  delete process.env.MY_SAFE_VAR;
});

describe('asyncExec — env sandbox', () => {
  it('敏感凭据不传递到子进程', async () => {
    const result = await asyncExec(
      'echo "ANTHROPIC=${ANTHROPIC_API_KEY:-MISSING} OPENAI=${OPENAI_API_KEY:-MISSING} PW=${DATABASE_PASSWORD:-MISSING}"',
      { timeoutMs: 10_000 },
    );
    expect(result.stdout).toContain('ANTHROPIC=MISSING');
    expect(result.stdout).toContain('OPENAI=MISSING');
    expect(result.stdout).toContain('PW=MISSING');
    expect(result.stdout).not.toContain('FAKE_LEAK_VALUE');
  });

  it('非敏感变量仍然可以访问', async () => {
    const result = await asyncExec('echo ${MY_SAFE_VAR:-MISSING}', { timeoutMs: 10_000 });
    expect(result.stdout.trim()).toBe('safe-value');
  });

  it('PATH 和 HOME 保留', async () => {
    const result = await asyncExec('echo "P=${PATH:-MISSING} H=${HOME:-MISSING}"', { timeoutMs: 10_000 });
    expect(result.stdout).not.toContain('MISSING');
  });

  it('EVOCLAW_SHELL 标签被设置', async () => {
    const result = await asyncExec('echo $EVOCLAW_SHELL', { timeoutMs: 10_000 });
    expect(result.stdout.trim()).toBe('async-exec');
  });

  it('options.env 能注入自定义变量，且覆盖敏感同名变量', async () => {
    const result = await asyncExec('echo "X=${X_VAR:-MISSING} A=${ANTHROPIC_API_KEY:-MISSING}"', {
      timeoutMs: 10_000,
      env: { X_VAR: 'xyz', ANTHROPIC_API_KEY: 'explicit' },
    });
    expect(result.stdout).toContain('X=xyz');
    // extraEnv 由调用方显式注入，允许覆盖 sanitize 结果
    expect(result.stdout).toContain('A=explicit');
  });

  it('customSensitivePatterns 扩展剥离', async () => {
    process.env.ACME_SECRET_CODE = 'acme';
    try {
      const result = await asyncExec('echo ${ACME_SECRET_CODE:-MISSING}', {
        timeoutMs: 10_000,
        customSensitivePatterns: [/^ACME_/i],
      });
      expect(result.stdout.trim()).toBe('MISSING');
    } finally {
      delete process.env.ACME_SECRET_CODE;
    }
  });
});
