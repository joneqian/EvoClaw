/**
 * Schema 验证器测试
 */

import { describe, it, expect } from 'vitest';
import { validateInput } from '../../agent/kernel/schema-validator.js';

describe('validateInput', () => {
  const schema = {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      offset: { type: 'number' },
      verbose: { type: 'boolean' },
    },
    required: ['file_path'],
  };

  it('合法输入应通过验证', () => {
    const result = validateInput({ file_path: '/test.txt', offset: 10 }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('缺少必需参数应报错', () => {
    const result = validateInput({ offset: 10 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('缺少必需参数: file_path');
  });

  it('类型错误应报错', () => {
    const result = validateInput({ file_path: 123 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('file_path');
    expect(result.errors[0]).toContain('string');
  });

  it('可选参数缺失不应报错', () => {
    const result = validateInput({ file_path: '/test.txt' }, schema);
    expect(result.valid).toBe(true);
  });

  it('多个错误应全部报告', () => {
    const result = validateInput({ offset: 'not_a_number' }, schema);
    expect(result.errors.length).toBeGreaterThanOrEqual(2); // 缺 file_path + offset 类型错误
  });

  it('空 schema 应全部通过', () => {
    const result = validateInput({ anything: true }, {});
    expect(result.valid).toBe(true);
  });
});
