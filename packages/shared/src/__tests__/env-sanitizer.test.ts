/**
 * M8 env-sanitizer 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeEnv,
  isSensitiveEnvName,
  compileCustomPatterns,
} from '../security/env-sanitizer.js';

describe('isSensitiveEnvName', () => {
  it.each([
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'GITHUB_TOKEN',
    'DATABASE_PASSWORD',
    'MY_CREDENTIAL',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GCP_PROJECT',
    'AZURE_CLIENT_SECRET',
    'SLACK_BOT_TOKEN',
    'STRIPE_SECRET_KEY',
    'SECRET_KEY',
    // M8 code-review M1: 变体覆盖
    'OPENAI_API_KEYS',
    'MY_TOKEN_V2',
    'DB_PASSWORD_FILE',
    'SESSION_SECRETS',
    'DB_PASSWD',
  ])('命中默认敏感模式: %s', (name) => {
    expect(isSensitiveEnvName(name)).toBe(true);
  });

  it.each(['PATH', 'HOME', 'USER', 'LANG', 'NODE_ENV', 'MY_VAR', 'FOO_BAR'])(
    '不应命中: %s',
    (name) => {
      expect(isSensitiveEnvName(name)).toBe(false);
    },
  );

  it('customPatterns 扩展生效', () => {
    const custom = compileCustomPatterns(['^ACME_INTERNAL_']);
    expect(isSensitiveEnvName('ACME_INTERNAL_TOKEN', custom)).toBe(true);
    expect(isSensitiveEnvName('ACME_INTERNAL_FOO', custom)).toBe(true);
    expect(isSensitiveEnvName('OTHER_VAR', custom)).toBe(false);
  });

  it('compileCustomPatterns 忽略非法正则', () => {
    // '[' 是非法正则
    const custom = compileCustomPatterns(['[', 'valid_pattern']);
    expect(custom).toHaveLength(1);
  });
});

describe('sanitizeEnv — inherit 模式（默认）', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/Users/foo',
    ANTHROPIC_API_KEY: 'sk-ant-xxx',
    OPENAI_API_KEY: 'sk-oai-xxx',
    DATABASE_PASSWORD: 'secret',
    MY_APP_VAR: 'hello',
    BRAVE_API_KEY: 'brv-xxx',
  };

  it('剥离敏感变量，保留其它', () => {
    const { env, stripped } = sanitizeEnv(parentEnv);
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/foo',
      MY_APP_VAR: 'hello',
    });
    expect(stripped.sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'BRAVE_API_KEY',
      'DATABASE_PASSWORD',
      'OPENAI_API_KEY',
    ]);
  });

  it('extraEnv 覆盖 parent 同名变量', () => {
    const { env } = sanitizeEnv(parentEnv, {
      extraEnv: { PATH: '/custom/bin', FOO: 'bar' },
    });
    expect(env.PATH).toBe('/custom/bin');
    expect(env.FOO).toBe('bar');
  });

  it('extraEnv 允许敏感变量（调用方自控）', () => {
    const { env } = sanitizeEnv(parentEnv, {
      extraEnv: { ANTHROPIC_API_KEY: 'override' },
    });
    expect(env.ANTHROPIC_API_KEY).toBe('override');
  });

  it('customSensitivePatterns 扩展剥离', () => {
    const { env, stripped } = sanitizeEnv(
      { ...parentEnv, MY_CUSTOM_CRED: 'yyy' },
      {
        customSensitivePatterns: [/^MY_CUSTOM_/i],
      },
    );
    expect(env.MY_CUSTOM_CRED).toBeUndefined();
    expect(stripped).toContain('MY_CUSTOM_CRED');
  });

  it('undefined value 自动跳过', () => {
    const { env } = sanitizeEnv({ FOO: 'bar', BAZ: undefined });
    expect(env).toEqual({ FOO: 'bar' });
  });
});

describe('sanitizeEnv — whitelist 模式（MCP server 使用）', () => {
  const parentEnv = {
    PATH: '/usr/bin',
    HOME: '/Users/foo',
    ANTHROPIC_API_KEY: 'sk-xxx',
    MY_APP_VAR: 'hello',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    NODE_ENV: 'production',
  };

  it('默认放行 + 前缀匹配', () => {
    const { env } = sanitizeEnv(parentEnv, { mode: 'whitelist' });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/foo',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      NODE_ENV: 'production',
    });
  });

  it('userPassthrough 放行非敏感变量', () => {
    const { env } = sanitizeEnv(parentEnv, {
      mode: 'whitelist',
      userPassthrough: ['MY_APP_VAR'],
    });
    expect(env.MY_APP_VAR).toBe('hello');
  });

  it('userPassthrough 不能放行敏感变量，但会记录 stripped', () => {
    const { env, stripped } = sanitizeEnv(parentEnv, {
      mode: 'whitelist',
      userPassthrough: ['ANTHROPIC_API_KEY'],
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(stripped).toContain('ANTHROPIC_API_KEY');
  });

  it('extraEnv（等同 MCP server 显式配置）总能注入', () => {
    const { env } = sanitizeEnv(parentEnv, {
      mode: 'whitelist',
      extraEnv: { CUSTOM_VAR: 'value' },
    });
    expect(env.CUSTOM_VAR).toBe('value');
  });
});
