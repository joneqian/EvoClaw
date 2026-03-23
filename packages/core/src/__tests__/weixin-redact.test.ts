import { describe, it, expect } from 'vitest';

import { redactToken, redactBody, redactUrl } from '../channel/adapters/weixin-redact.js';

describe('weixin-redact', () => {
  // -----------------------------------------------------------------------
  // redactToken
  // -----------------------------------------------------------------------

  describe('redactToken', () => {
    it('应只显示前 N 个字符并附加长度', () => {
      const result = redactToken('abcdefghijklmnop');
      expect(result).toBe('abcdef***(len=16)');
    });

    it('token 短于 showChars 时应完全隐藏', () => {
      const result = redactToken('abc');
      expect(result).toBe('****(len=3)');
    });

    it('空值应返回 (none)', () => {
      expect(redactToken(undefined)).toBe('(none)');
      expect(redactToken('')).toBe('(none)');
    });

    it('应支持自定义 showChars', () => {
      const result = redactToken('abcdefghijklmnop', 3);
      expect(result).toBe('abc***(len=16)');
    });

    it('token 刚好等于 showChars 时应完全隐藏', () => {
      const result = redactToken('abcdef', 6);
      expect(result).toBe('****(len=6)');
    });
  });

  // -----------------------------------------------------------------------
  // redactBody
  // -----------------------------------------------------------------------

  describe('redactBody', () => {
    it('短字符串不应被截断', () => {
      const result = redactBody('hello world');
      expect(result).toBe('hello world');
    });

    it('长字符串应被截断并附加原始长度', () => {
      const longStr = 'a'.repeat(300);
      const result = redactBody(longStr);
      expect(result).toBe(`${'a'.repeat(200)}...(len=300)`);
    });

    it('空值应返回 (empty)', () => {
      expect(redactBody(undefined)).toBe('(empty)');
      expect(redactBody('')).toBe('(empty)');
    });

    it('应支持自定义 maxLen', () => {
      const result = redactBody('abcdefghij', 5);
      expect(result).toBe('abcde...(len=10)');
    });

    it('刚好等于 maxLen 时不应截断', () => {
      const result = redactBody('abcde', 5);
      expect(result).toBe('abcde');
    });
  });

  // -----------------------------------------------------------------------
  // redactUrl
  // -----------------------------------------------------------------------

  describe('redactUrl', () => {
    it('应去除查询参数', () => {
      const result = redactUrl('https://example.com/api/data?token=secret&key=value');
      expect(result).toBe('https://example.com/api/data');
    });

    it('无查询参数时应保持不变', () => {
      const result = redactUrl('https://example.com/api/data');
      expect(result).toBe('https://example.com/api/data');
    });

    it('应保留路径部分', () => {
      const result = redactUrl('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage?sig=abc');
      expect(result).toBe('https://ilinkai.weixin.qq.com/ilink/bot/sendmessage');
    });

    it('无效 URL 应截断返回', () => {
      const result = redactUrl('not-a-url');
      expect(result).toBe('not-a-url');
    });

    it('无效 URL 超长时应截断', () => {
      const longUrl = 'x'.repeat(100);
      const result = redactUrl(longUrl);
      expect(result).toBe(`${'x'.repeat(80)}...(len=100)`);
    });
  });
});
