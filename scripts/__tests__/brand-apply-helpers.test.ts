import { describe, it, expect } from 'vitest';
import {
  resolveEnv,
  resolveDeep,
  hasUnset,
  applyRelease,
  UNSET,
} from '../lib/brand-apply-helpers.mjs';

// ─── resolveEnv ──────────────────────────────────────────────────────────────

describe('resolveEnv', () => {
  it('替换单个占位符', () => {
    expect(resolveEnv('${FOO}', { FOO: 'bar' })).toBe('bar');
  });

  it('替换多个占位符', () => {
    expect(resolveEnv('${A}-${B}', { A: '1', B: '2' })).toBe('1-2');
  });

  it('缺失变量返回 sentinel 标记', () => {
    const out = resolveEnv('${MISSING}', {});
    expect(out).toBe(UNSET);
  });

  it('空字符串环境变量视作缺失', () => {
    const out = resolveEnv('${EMPTY}', { EMPTY: '' });
    expect(out).toBe(UNSET);
  });

  it('非字符串原样返回', () => {
    expect(resolveEnv(42 as any, {})).toBe(42);
    expect(resolveEnv(null as any, {})).toBe(null);
  });

  it('没有占位符的字符串原样返回', () => {
    expect(resolveEnv('plain text', { FOO: 'bar' })).toBe('plain text');
  });

  it('部分缺失导致整条 sentinel', () => {
    const out = resolveEnv('${A}-${MISSING}', { A: '1' });
    expect(out).toContain(UNSET);
  });
});

// ─── resolveDeep ─────────────────────────────────────────────────────────────

describe('resolveDeep', () => {
  it('递归解析对象', () => {
    const input = { a: '${X}', b: { c: '${Y}' } };
    const out = resolveDeep(input, { X: '1', Y: '2' });
    expect(out).toEqual({ a: '1', b: { c: '2' } });
  });

  it('递归解析数组', () => {
    const out = resolveDeep(['${A}', '${B}'], { A: 'x', B: 'y' });
    expect(out).toEqual(['x', 'y']);
  });

  it('保留原始类型（数字/布尔/null）', () => {
    const input = { a: 1, b: true, c: null };
    const out = resolveDeep(input, {});
    expect(out).toEqual({ a: 1, b: true, c: null });
  });

  it('不修改原对象', () => {
    const input = { a: '${X}' };
    resolveDeep(input, { X: 'v' });
    expect(input.a).toBe('${X}');
  });
});

// ─── hasUnset ────────────────────────────────────────────────────────────────

describe('hasUnset', () => {
  it('标量检测', () => {
    expect(hasUnset(UNSET)).toBe(true);
    expect(hasUnset('hello')).toBe(false);
    expect(hasUnset(null)).toBe(false);
    expect(hasUnset(42)).toBe(false);
  });

  it('嵌套对象检测', () => {
    expect(hasUnset({ a: { b: UNSET } })).toBe(true);
    expect(hasUnset({ a: { b: 'ok' } })).toBe(false);
  });

  it('数组检测', () => {
    expect(hasUnset(['ok', UNSET])).toBe(true);
    expect(hasUnset(['ok', 'ok2'])).toBe(false);
  });
});

// ─── applyRelease ────────────────────────────────────────────────────────────

describe('applyRelease', () => {
  const baseTauriConf = () => ({
    productName: 'EvoClaw',
    bundle: { active: true, targets: ['dmg'], macOS: { minimumSystemVersion: '13.0' } },
    plugins: {},
  });

  it('signing identity 已配置时写入 tauri.conf', () => {
    const release = {
      macOS: { signingIdentity: '${APPLE_ID_EVOCLAW}' },
    };
    const out = applyRelease(baseTauriConf(), release, { APPLE_ID_EVOCLAW: 'Developer ID: Foo' });
    expect(out.bundle.macOS!.signingIdentity).toBe('Developer ID: Foo');
  });

  it('signing identity 缺失时不写入该字段', () => {
    const release = {
      macOS: { signingIdentity: '${APPLE_ID_EVOCLAW}' },
    };
    const out = applyRelease(baseTauriConf(), release, {});
    expect(out.bundle.macOS!.signingIdentity).toBeUndefined();
    expect(out.bundle.macOS!.minimumSystemVersion).toBe('13.0');
  });

  it('updater 完整配置时 plugins.updater 建立', () => {
    const release = {
      updater: {
        active: true,
        endpoints: ['${UPDATER_URL}'],
        pubkey: '${PUBKEY}',
      },
    };
    const out = applyRelease(baseTauriConf(), release, {
      UPDATER_URL: 'https://u.example.com/latest.json',
      PUBKEY: 'abc123',
    });
    expect(out.plugins.updater).toBeDefined();
    expect(out.plugins.updater!.endpoints).toEqual(['https://u.example.com/latest.json']);
    expect(out.plugins.updater!.pubkey).toBe('abc123');
  });

  it('updater pubkey 缺失时整个 updater plugin 不配置', () => {
    const release = {
      updater: {
        endpoints: ['${UPDATER_URL}'],
        pubkey: '${PUBKEY}',
      },
    };
    const out = applyRelease(baseTauriConf(), release, { UPDATER_URL: 'https://u.example.com/latest.json' });
    expect(out.plugins.updater).toBeUndefined();
  });

  it('Windows certificateThumbprint 已配置时 bundle.windows 被写入', () => {
    const release = {
      windows: { certificateThumbprint: '${WIN_THUMB}', digestAlgorithm: 'sha256' },
    };
    const out = applyRelease(baseTauriConf(), release, { WIN_THUMB: 'DEADBEEF' });
    expect(out.bundle.windows!.certificateThumbprint).toBe('DEADBEEF');
    expect(out.bundle.windows!.digestAlgorithm).toBe('sha256');
  });

  it('空 release 配置不触碰 tauri conf', () => {
    const base = baseTauriConf();
    const out = applyRelease(base, {}, {});
    expect(out).toEqual(base);
  });

  it('不修改输入 tauriConf 对象', () => {
    const base = baseTauriConf();
    const snapshot = JSON.stringify(base);
    applyRelease(base, { macOS: { signingIdentity: 'x' } }, {});
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('幂等：env 缺失时清理上一轮残留的 updater 配置', () => {
    const tauriConf = {
      ...baseTauriConf(),
      plugins: {
        shell: { open: true },
        updater: { endpoints: ['https://old.example.com'], pubkey: 'old' },
      },
    };
    const release = {
      updater: { endpoints: ['${URL}'], pubkey: '${PUBKEY}' },
    };
    const out = applyRelease(tauriConf, release, {});
    expect(out.plugins.updater).toBeUndefined();
    expect(out.plugins.shell).toEqual({ open: true });
  });

  it('幂等：env 缺失时清理上一轮残留的 signing identity', () => {
    const tauriConf = {
      ...baseTauriConf(),
      bundle: {
        active: true,
        macOS: { signingIdentity: 'Old ID', minimumSystemVersion: '13.0' },
      },
    };
    const release = {
      macOS: { signingIdentity: '${ID}', minimumSystemVersion: '13.0' },
    };
    const out = applyRelease(tauriConf, release, {});
    expect(out.bundle.macOS!.signingIdentity).toBeUndefined();
    expect(out.bundle.macOS!.minimumSystemVersion).toBe('13.0');
  });

  it('Windows digestAlgorithm 存在但 certificateThumbprint 缺失时不建 windows 块', () => {
    const release = {
      windows: { certificateThumbprint: '${THUMB}', digestAlgorithm: 'sha256' },
    };
    const out = applyRelease(baseTauriConf(), release, {});
    expect(out.bundle.windows).toBeUndefined();
  });
});
