import { describe, it, expect } from 'vitest';
import { sanitizePII, sanitizeObject } from '../infrastructure/pii-sanitizer.js';

describe('sanitizePII', () => {
  it('替换 OpenAI API Key', () => {
    const text = 'Using key sk-proj-abc123def456ghi789jkl012mno345';
    expect(sanitizePII(text)).toBe('Using key sk-***');
  });

  it('替换 Anthropic API Key', () => {
    const text = 'Key: sk-ant-api03-abcdefghijklmnopqrstuv';
    expect(sanitizePII(text)).toBe('Key: sk-ant-***');
  });

  it('替换 Bearer token', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c';
    expect(sanitizePII(text)).toContain('[REDACTED]');
    expect(sanitizePII(text)).not.toContain('eyJhbGci');
  });

  it('替换 JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A';
    expect(sanitizePII(jwt)).toBe('jwt:[REDACTED]');
  });

  it('替换邮箱', () => {
    expect(sanitizePII('Contact: user@example.com')).toBe('Contact: email:[REDACTED]');
  });

  it('替换中国手机号', () => {
    expect(sanitizePII('Phone: 13812345678')).toBe('Phone: phone:[REDACTED]');
  });

  it('不误伤非手机号数字', () => {
    expect(sanitizePII('ID: 123456789012')).toBe('ID: 123456789012');
  });

  it('替换 JSON 中的密码字段', () => {
    const json = '{"apiKey": "sk-secret-value", "name": "test"}';
    const result = sanitizePII(json);
    expect(result).toContain('"apiKey": "[REDACTED]"');
    expect(result).toContain('"name": "test"');
  });

  it('替换 x-api-key', () => {
    expect(sanitizePII('x-api-key: sk-ant-api-abcdefghij')).toContain('[REDACTED]');
  });

  it('无敏感数据时原样返回', () => {
    const text = 'Normal log message without PII';
    expect(sanitizePII(text)).toBe(text);
  });

  it('混合多种敏感数据', () => {
    const text = 'User user@test.com called with Bearer sk-proj-1234567890abcdefghijklmno';
    const result = sanitizePII(text);
    expect(result).not.toContain('user@test.com');
    expect(result).not.toContain('sk-proj-1234567890');
  });
});

describe('sanitizeObject', () => {
  it('脱敏对象中的敏感键值', () => {
    const obj = { name: 'test', apiKey: 'sk-secret', password: '123456' };
    const result = sanitizeObject(obj) as Record<string, unknown>;
    expect(result.name).toBe('test');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
  });

  it('递归脱敏嵌套对象', () => {
    const obj = { provider: { apiKey: 'key123', name: 'OpenAI' } };
    const result = sanitizeObject(obj) as any;
    expect(result.provider.apiKey).toBe('[REDACTED]');
    expect(result.provider.name).toBe('OpenAI');
  });

  it('脱敏数组', () => {
    const arr = [{ token: 'abc' }, { name: 'ok' }];
    const result = sanitizeObject(arr) as any[];
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[1].name).toBe('ok');
  });

  it('字符串值走 sanitizePII', () => {
    const obj = { log: 'User sk-proj-12345678901234567890 logged in' };
    const result = sanitizeObject(obj) as any;
    expect(result.log).toBe('User sk-*** logged in');
  });

  it('null/undefined 原样返回', () => {
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
  });
});
