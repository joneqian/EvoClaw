/**
 * 引用消息文本前缀 —— 组装 + 解析（前后端共享格式约定）
 */
import { describe, it, expect } from 'vitest';
import {
  composeMessageWithQuote,
  parseQuotedPrefix,
  QUOTED_MESSAGE_OPEN_RE,
  type QuotedMessage,
} from '@evoclaw/shared';

describe('composeMessageWithQuote', () => {
  it('无 quoted 返回原文', () => {
    expect(composeMessageWithQuote('你好')).toBe('你好');
    expect(composeMessageWithQuote('你好', undefined)).toBe('你好');
  });

  it('带 quoted 生成 XML 前缀 + 两空行 + 原文', () => {
    const quoted: QuotedMessage = {
      messageId: 'om_1',
      senderId: 'ou_bot',
      senderName: '龙虾-CEO',
      content: '今天是 2026年4月22日',
      timestamp: 1700000000000,
    };
    const result = composeMessageWithQuote('你这条说了什么？', quoted);
    expect(result).toContain('<quoted_message');
    expect(result).toContain('from="龙虾-CEO"');
    expect(result).toContain('id="om_1"');
    expect(result).toContain('sender="ou_bot"');
    expect(result).toContain('今天是 2026年4月22日');
    expect(result).toContain('</quoted_message>');
    expect(result.endsWith('你这条说了什么？')).toBe(true);
    // 前缀与正文之间必须是空行
    expect(result).toMatch(/<\/quoted_message>\n\n你这条说了什么？$/);
  });

  it('senderName 缺失时回落为 senderId', () => {
    const result = composeMessageWithQuote('Q', {
      messageId: 'om_2',
      senderId: 'ou_raw',
      content: 'A',
    });
    expect(result).toContain('from="ou_raw"');
  });

  it('HTML 转义保护：内容含引号 / 尖括号', () => {
    const result = composeMessageWithQuote('Q', {
      messageId: 'om_3',
      senderId: 'ou_u',
      senderName: 'Alice "Admin"',
      content: '<script>alert("xss")</script>',
    });
    // 属性中的双引号必须转义，避免破坏 XML 结构
    expect(result).toContain('from="Alice &quot;Admin&quot;"');
    // 正文中的 < 和 > 同样需要转义（否则前端解析 XML 时会错位）
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('&quot;xss&quot;');
  });
});

describe('parseQuotedPrefix', () => {
  it('无前缀时 quoted 为 undefined，rest 等于原文', () => {
    const r = parseQuotedPrefix('你好');
    expect(r.quoted).toBeUndefined();
    expect(r.rest).toBe('你好');
  });

  it('可以还原 composeMessageWithQuote 生成的内容', () => {
    const quoted: QuotedMessage = {
      messageId: 'om_1',
      senderId: 'ou_bot',
      senderName: '龙虾-CEO',
      content: '今天是 2026年4月22日',
      timestamp: 1700000000000,
    };
    const composed = composeMessageWithQuote('你这条说了什么？', quoted);
    const r = parseQuotedPrefix(composed);
    expect(r.rest).toBe('你这条说了什么？');
    expect(r.quoted).toMatchObject({
      messageId: 'om_1',
      senderId: 'ou_bot',
      senderName: '龙虾-CEO',
      content: '今天是 2026年4月22日',
    });
  });

  it('转义字符能原样还原', () => {
    const quoted: QuotedMessage = {
      messageId: 'om_3',
      senderId: 'ou_u',
      senderName: 'Alice "Admin"',
      content: '<script>alert("xss")</script>',
    };
    const composed = composeMessageWithQuote('hi', quoted);
    const r = parseQuotedPrefix(composed);
    expect(r.quoted?.senderName).toBe('Alice "Admin"');
    expect(r.quoted?.content).toBe('<script>alert("xss")</script>');
    expect(r.rest).toBe('hi');
  });

  it('损坏/不完整前缀时 rest 原样返回', () => {
    const broken = '<quoted_message id="om_1">没闭合标签\n你好';
    const r = parseQuotedPrefix(broken);
    expect(r.quoted).toBeUndefined();
    expect(r.rest).toBe(broken);
  });

  it('QUOTED_MESSAGE_OPEN_RE 仅识别开头位置', () => {
    expect(QUOTED_MESSAGE_OPEN_RE.test('<quoted_message ')).toBe(true);
    expect(QUOTED_MESSAGE_OPEN_RE.test('hi <quoted_message ')).toBe(false);
  });
});
