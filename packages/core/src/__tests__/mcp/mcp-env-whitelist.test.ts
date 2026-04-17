import { describe, it, expect } from 'vitest';
import { buildMcpEnv, isSensitiveEnvName } from '../../mcp/mcp-env.js';

describe('isSensitiveEnvName', () => {
  it('识别 API Key 后缀', () => {
    expect(isSensitiveEnvName('OPENAI_API_KEY')).toBe(true);
    expect(isSensitiveEnvName('CUSTOM_API_KEY')).toBe(true);
  });
  it('识别 Token 后缀', () => {
    expect(isSensitiveEnvName('GITHUB_TOKEN')).toBe(true);
    expect(isSensitiveEnvName('AUTH_TOKEN')).toBe(true);
  });
  it('识别 Secret 后缀/前缀', () => {
    expect(isSensitiveEnvName('AWS_SECRET')).toBe(true);
    expect(isSensitiveEnvName('SECRET_KEY')).toBe(true);
  });
  it('识别供应商前缀', () => {
    expect(isSensitiveEnvName('ANTHROPIC_API_KEY')).toBe(true);
    expect(isSensitiveEnvName('AWS_ACCESS_KEY_ID')).toBe(true);
    expect(isSensitiveEnvName('GH_PAT')).toBe(true);
  });
  it('普通变量不应误判', () => {
    expect(isSensitiveEnvName('PATH')).toBe(false);
    expect(isSensitiveEnvName('HOME')).toBe(false);
    expect(isSensitiveEnvName('LANG')).toBe(false);
  });
});

describe('buildMcpEnv', () => {
  const dirtyEnv = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'C',
    OPENAI_API_KEY: 'sk-secret-123',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    GITHUB_TOKEN: 'ghp_abc',
    AWS_ACCESS_KEY_ID: 'AKIAxxx',
    MY_CUSTOM_VAR: 'safe-value',
    DATABASE_PASSWORD: 'p@ss',
  };

  it('默认白名单透传 PATH/HOME/LANG/LC_*', () => {
    const { env } = buildMcpEnv(dirtyEnv);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/user');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.LC_ALL).toBe('C');
  });

  it('默认拒所有 API Key / Token / Secret', () => {
    const { env } = buildMcpEnv(dirtyEnv);
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.DATABASE_PASSWORD).toBeUndefined();
  });

  it('未显式放行的变量被剥离（如 MY_CUSTOM_VAR）', () => {
    const { env } = buildMcpEnv(dirtyEnv);
    expect(env.MY_CUSTOM_VAR).toBeUndefined();
  });

  it('用户显式放行后非敏感变量可透传', () => {
    const { env } = buildMcpEnv(dirtyEnv, undefined, ['MY_CUSTOM_VAR']);
    expect(env.MY_CUSTOM_VAR).toBe('safe-value');
  });

  it('用户显式放行也无法解锁敏感变量', () => {
    const { env } = buildMcpEnv(dirtyEnv, undefined, ['OPENAI_API_KEY']);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('server 显式 env 覆盖一切（用户为 server 配的就是想传）', () => {
    const { env } = buildMcpEnv(dirtyEnv, { CUSTOM_TOKEN: 'user-provided' });
    // server 显式 env 不走白名单/敏感检查（这是用户为该 server 主动配的）
    expect(env.CUSTOM_TOKEN).toBe('user-provided');
  });

  it('返回 stripped 列表用于日志告知用户', () => {
    const { stripped } = buildMcpEnv(dirtyEnv);
    // 默认白名单内的敏感变量不会进入 stripped；只记录"曾尝试放行但被剥离"的
    // dirtyEnv 中没有"既在白名单又敏感"的变量，stripped 应为空
    expect(stripped).toEqual([]);
  });

  it('用户尝试放行敏感变量时 stripped 记录该名', () => {
    const { stripped } = buildMcpEnv(dirtyEnv, undefined, ['OPENAI_API_KEY', 'SAFE_VAR']);
    expect(stripped).toContain('OPENAI_API_KEY');
    expect(stripped).not.toContain('SAFE_VAR'); // SAFE_VAR 不存在于 dirtyEnv
  });
});
