import { describe, it, expect } from 'vitest';
import { sanitizeCredentials } from '../../infrastructure/credential-sanitizer.js';

// 测试用 helper：把 unknown 钻取为字符串
function getStr(obj: unknown, ...keys: (string | number)[]): string {
  let cur: unknown = obj;
  for (const k of keys) cur = (cur as Record<string | number, unknown>)?.[k];
  return cur as string;
}

describe('sanitizeCredentials', () => {
  it('全角字母 → 半角（normalizeUnicode 全角 ASCII 处理）', () => {
    const fullwidth = 'ｓｋ-ant-' + 'X'.repeat(20);
    const result = sanitizeCredentials({
      models: { providers: { anthropic: { apiKey: fullwidth } } },
    });
    expect(getStr(result.sanitized, 'models', 'providers', 'anthropic', 'apiKey'))
      .toBe('sk-ant-' + 'X'.repeat(20));
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('models.providers.anthropic.apiKey');
  });

  it('Cyrillic 同形字 (а→a) → ASCII', () => {
    const tricky = 'sk-ant-аbcdefghijklmnopqrs'; // 含 cyrillic а
    const result = sanitizeCredentials({
      models: { providers: { anthropic: { apiKey: tricky } } },
    });
    expect(getStr(result.sanitized, 'models', 'providers', 'anthropic', 'apiKey'))
      .toBe('sk-ant-abcdefghijklmnopqrs');
  });

  it('非 ASCII 残余字符（中文）→ 剥离', () => {
    const dirty = 'sk-ant-中文XYZ';
    const result = sanitizeCredentials({
      models: { providers: { anthropic: { apiKey: dirty } } },
    });
    expect(getStr(result.sanitized, 'models', 'providers', 'anthropic', 'apiKey'))
      .toBe('sk-ant-XYZ');
    expect(result.warnings[0]).toContain('apiKey');
  });

  it('正常 ASCII 不改 + 不发 warning', () => {
    const clean = 'sk-ant-' + 'A'.repeat(40);
    const result = sanitizeCredentials({
      models: { providers: { anthropic: { apiKey: clean } } },
    });
    expect(getStr(result.sanitized, 'models', 'providers', 'anthropic', 'apiKey')).toBe(clean);
    expect(result.warnings.length).toBe(0);
  });

  it('多个敏感字段都报 warning（独立路径）', () => {
    const result = sanitizeCredentials({
      models: {
        providers: {
          a: { apiKey: 'ｓｋ-1' },
          b: { apiKey: 'ｓｋ-2', secret: 'ｓｅｃｒｅｔ' },
        },
      },
    });
    expect(result.warnings.length).toBe(3);
    expect(result.warnings.some((w) => w.includes('a.apiKey'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('b.apiKey'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('b.secret'))).toBe(true);
  });

  it('非凭证字段不动（如 models.default 是 provider/modelId 字符串）', () => {
    const result = sanitizeCredentials({
      models: { default: 'anthropic/claude-haiku' },
    });
    expect(getStr(result.sanitized, 'models', 'default')).toBe('anthropic/claude-haiku');
    expect(result.warnings.length).toBe(0);
  });

  it('null / undefined / 空值安全跳过', () => {
    const result = sanitizeCredentials({
      models: {
        providers: {
          a: { apiKey: undefined },
          b: { apiKey: null },
          c: { apiKey: '' },
        },
      },
    });
    expect(result.warnings.length).toBe(0);
  });

  it('数组中的对象元素递归处理', () => {
    const result = sanitizeCredentials({
      models: {
        providers: {
          x: {
            models: [
              { id: 'm1', apiKey: 'ｐｋ-fake' },
              { id: 'm2' },
            ],
          },
        },
      },
    });
    const arr = (result.sanitized as Record<string, Record<string, Record<string, Record<string, Array<Record<string, unknown>>>>>>)
      .models.providers.x.models;
    expect(arr[0]!.apiKey).toBe('pk-fake');
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('models[0].apiKey');
  });

  it('循环引用安全防护（不应栈溢出）', () => {
    const obj: Record<string, unknown> = { models: { providers: { a: { apiKey: 'ｓｋ' } } } };
    obj.self = obj; // 故意循环
    const result = sanitizeCredentials(obj);
    expect(result.warnings.length).toBe(1); // a.apiKey 被处理
    // 不应抛栈溢出
  });
});
