/**
 * Feature Flag 模块测试
 *
 * 覆盖:
 * - 开发模式回退（环境变量 ENABLE_*）
 * - Feature 对象 getter
 * - getFeatureStatus() 诊断
 * - 默认值（无环境变量时应为 false）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Feature Flag', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv };
  });

  it('默认所有 Feature 应为 false（开发模式，无环境变量）', async () => {
    delete process.env.ENABLE_SANDBOX;
    delete process.env.ENABLE_WEIXIN;
    delete process.env.ENABLE_MCP;
    delete process.env.ENABLE_SILK_VOICE;
    delete process.env.ENABLE_WECOM;
    delete process.env.ENABLE_FEISHU;

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.SANDBOX).toBe(false);
    expect(Feature.WEIXIN).toBe(false);
    expect(Feature.MCP).toBe(false);
    expect(Feature.SILK_VOICE).toBe(false);
    expect(Feature.WECOM).toBe(false);
    expect(Feature.FEISHU).toBe(false);
  });

  it('ENABLE_WEIXIN=true 应启用 WEIXIN Feature', async () => {
    process.env.ENABLE_WEIXIN = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.WEIXIN).toBe(true);
    expect(Feature.SANDBOX).toBe(false); // 其他不受影响
  });

  it('ENABLE_SANDBOX=true 应启用 SANDBOX Feature', async () => {
    process.env.ENABLE_SANDBOX = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.SANDBOX).toBe(true);
  });

  it('ENABLE_MCP=true 应启用 MCP Feature', async () => {
    process.env.ENABLE_MCP = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.MCP).toBe(true);
  });

  it('ENABLE_SILK_VOICE=true 应启用 SILK_VOICE Feature', async () => {
    process.env.ENABLE_SILK_VOICE = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.SILK_VOICE).toBe(true);
  });

  it('非 "true" 字符串不应启用 Feature', async () => {
    process.env.ENABLE_WEIXIN = 'yes';
    process.env.ENABLE_SANDBOX = '1';
    process.env.ENABLE_MCP = 'TRUE'; // 大写

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.WEIXIN).toBe(false);
    expect(Feature.SANDBOX).toBe(false);
    expect(Feature.MCP).toBe(false);
  });

  it('getFeatureStatus 应返回所有 Flag 状态（含描述和模块信息）', async () => {
    process.env.ENABLE_WEIXIN = 'true';
    delete process.env.ENABLE_SANDBOX;

    const { getFeatureStatus, FEATURE_NAMES } = await import('../../infrastructure/feature.js');
    const status = getFeatureStatus();

    // 数量与 FEATURE_REGISTRY 一致
    expect(Object.keys(status)).toHaveLength(FEATURE_NAMES.length);

    // 验证结构
    expect(status.WEIXIN.enabled).toBe(true);
    expect(status.WEIXIN.desc).toBeTruthy();
    expect(status.WEIXIN.modules).toBeInstanceOf(Array);

    expect(status.SANDBOX.enabled).toBe(false);
    expect(status.MCP.enabled).toBe(false);
    expect(status.SILK_VOICE.enabled).toBe(false);
  });

  it('多个 Feature 可同时启用', async () => {
    process.env.ENABLE_WEIXIN = 'true';
    process.env.ENABLE_MCP = 'true';
    process.env.ENABLE_SILK_VOICE = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.WEIXIN).toBe(true);
    expect(Feature.MCP).toBe(true);
    expect(Feature.SILK_VOICE).toBe(true);
    expect(Feature.SANDBOX).toBe(false);
  });

  it('ENABLE_WECOM=true 应启用 WECOM Feature', async () => {
    process.env.ENABLE_WECOM = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.WECOM).toBe(true);
    expect(Feature.FEISHU).toBe(false);
  });

  it('ENABLE_FEISHU=true 应启用 FEISHU Feature', async () => {
    process.env.ENABLE_FEISHU = 'true';

    const { Feature } = await import('../../infrastructure/feature.js');
    expect(Feature.FEISHU).toBe(true);
    expect(Feature.WECOM).toBe(false);
  });

  it('FEATURE_REGISTRY 应包含所有 Flag 的元数据', async () => {
    const { FEATURE_REGISTRY, FEATURE_NAMES } = await import('../../infrastructure/feature.js');

    expect(FEATURE_NAMES.length).toBeGreaterThanOrEqual(6);
    for (const name of FEATURE_NAMES) {
      const meta = FEATURE_REGISTRY[name];
      expect(meta.desc).toBeTruthy();
      expect(meta.modules).toBeInstanceOf(Array);
      expect(meta.modules.length).toBeGreaterThan(0);
    }
  });
});
