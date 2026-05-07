/**
 * Provider Auth Strategy - custom 扩展点验证
 *
 * 单独成文：通过 vi.mock 注入一个临时 provider 到 catalog，验证 buildAuthHeaders
 * 能正确分发到 custom strategy 的 customHeaders 函数。
 *
 * 这是 PR C 的核心收益证明——加新 provider 不必改 model-fetcher.ts。
 */

import { describe, it, expect, vi } from 'vitest';

// vi.mock 必须在 import 前生效，且 factory 内不能引用模块外变量（除了 vi.hoisted）
const { customCalls } = vi.hoisted(() => ({
  customCalls: [] as string[],
}));

vi.mock('../provider/extensions/catalog.js', async (importOriginal) => {
  const orig =
    await importOriginal<typeof import('../provider/extensions/catalog.js')>();
  return {
    ...orig,
    PROVIDER_CATALOG: [
      ...orig.PROVIDER_CATALOG,
      {
        id: 'test-virtual-gateway',
        name: 'Test Virtual',
        defaultBaseUrl: 'https://virtual.test',
        api: 'openai-completions' as const,
        models: [],
        authStrategy: {
          kind: 'custom' as const,
          customHeaders: (apiKey: string) => {
            customCalls.push(apiKey);
            return {
              'X-Custom-Auth': `custom-${apiKey}`,
              'X-Trace-Id': 'fixed-trace',
            };
          },
        },
      },
    ],
  };
});

const { buildAuthHeaders, resolveAuthStrategy } = await import(
  '../provider/model-fetcher.js'
);

describe('custom auth strategy 端到端验证', () => {
  it('catalog 中声明 custom strategy 的 provider 能正确 dispatch', () => {
    const h = buildAuthHeaders('mykey', 'test-virtual-gateway', 'https://virtual.test');
    expect(h).toEqual({
      'Content-Type': 'application/json',
      'X-Custom-Auth': 'custom-mykey',
      'X-Trace-Id': 'fixed-trace',
    });
    // 不应有 Bearer / x-api-key（custom 完全替换）
    expect(h['Authorization']).toBeUndefined();
    expect(h['x-api-key']).toBeUndefined();
  });

  it('custom strategy 的 apiKey 正确传给 customHeaders 函数', () => {
    const before = customCalls.length;
    buildAuthHeaders('different-key', 'test-virtual-gateway', 'https://virtual.test');
    expect(customCalls[before]).toBe('different-key');
  });

  it('resolveAuthStrategy 返回 custom strategy 对象（kind=custom）', () => {
    const s = resolveAuthStrategy('k', 'test-virtual-gateway', 'https://virtual.test');
    expect(typeof s).toBe('object');
    expect((s as { kind: string }).kind).toBe('custom');
  });

  it('真实 provider（anthropic）不受影响', () => {
    // 共存验证：catalog 注入的 mock provider 不污染其他 provider
    const h = buildAuthHeaders('sk-ant-x', 'anthropic', 'https://api.anthropic.com/v1');
    expect(h['x-api-key']).toBe('sk-ant-x');
    expect(h['X-Custom-Auth']).toBeUndefined();
  });
});
