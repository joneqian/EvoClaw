import { describe, it, expect } from 'vitest';
import { detectUnicodeConfusion, normalizeUnicode } from '../security/unicode-detector.js';

describe('unicode-detector', () => {
  // ── A. 同形字检测 (6 个) ──

  it('检测 Cyrillic 同形字', () => {
    // а (U+0430 Cyrillic) 看起来像 a (U+0061 Latin)
    const r = detectUnicodeConfusion('p\u0430ssword');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('Cyrillic'))).toBe(true);
  });

  it('检测 Greek 同形字', () => {
    // ο (U+03BF Greek) 看起来像 o (U+006F Latin)
    const r = detectUnicodeConfusion('hell\u03BF');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('Greek'))).toBe(true);
  });

  it('检测数学字母符号', () => {
    // 𝐀 (U+1D400) Mathematical Bold Capital A
    const r = detectUnicodeConfusion('test \uD835\uDC00');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('数学字母'))).toBe(true);
  });

  it('检测全角 ASCII', () => {
    // ｒｍ (全角 rm)
    const r = detectUnicodeConfusion('\uFF52\uFF4D -rf /');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('全角'))).toBe(true);
  });

  it('检测混合脚本', () => {
    // Latin 'a' + Cyrillic 'с' (U+0441)
    const r = detectUnicodeConfusion('a\u0441cess');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('Latin/Cyrillic'))).toBe(true);
  });

  it('纯 ASCII 不触发', () => {
    const r = detectUnicodeConfusion('hello world 123');
    expect(r.detected).toBe(false);
    expect(r.issues).toEqual([]);
  });

  // ── B. 不可见字符检测 (6 个) ──

  it('检测零宽空格', () => {
    const r = detectUnicodeConfusion('test\u200Bcommand');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('零宽空格'))).toBe(true);
  });

  it('检测零宽连接符', () => {
    const r = detectUnicodeConfusion('rm\u200D-rf');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('零宽连接符'))).toBe(true);
  });

  it('检测 RTL 覆盖', () => {
    const r = detectUnicodeConfusion('file\u202Ename');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('RTL 覆盖'))).toBe(true);
  });

  it('检测蒙古文元音分隔符', () => {
    const r = detectUnicodeConfusion('test\u180Edata');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('蒙古文'))).toBe(true);
  });

  it('检测软连字符', () => {
    const r = detectUnicodeConfusion('com\u00ADmand');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('软连字符'))).toBe(true);
  });

  it('排除 EvoClaw 反馈循环标记', () => {
    // EvoClaw 使用 \u200B\u200C\u200B 作为标记序列
    const markerSequence = '\u200B\u200C\u200B';
    const r = detectUnicodeConfusion(`${markerSequence}__EVOCLAW_MEM_START__${markerSequence}normal text${markerSequence}__EVOCLAW_MEM_END__${markerSequence}`);
    // 标记序列被排除后，不应检测到不可见字符（NFKC 差异可能触发）
    const hasInvisibleIssue = r.issues.some(i => i.includes('零宽') || i.includes('非连接符'));
    expect(hasInvisibleIssue).toBe(false);
  });

  // ── C. NFKC 规范化 (4 个) ──

  it('NFKC 检测全角转半角', () => {
    const r = detectUnicodeConfusion('\uFF41\uFF42\uFF43'); // ａｂｃ
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('NFKC'))).toBe(true);
  });

  it('normalizeUnicode 将全角转为半角', () => {
    const result = normalizeUnicode('\uFF52\uFF4D'); // ｒｍ → rm
    expect(result).toBe('rm');
  });

  it('normalizeUnicode 将 Cyrillic 同形字替换为 Latin', () => {
    const result = normalizeUnicode('p\u0430ss'); // а → a
    expect(result).toBe('pass');
  });

  it('normalizeUnicode 移除不可见字符', () => {
    const result = normalizeUnicode('te\u200Bst'); // 零宽空格移除
    expect(result).toBe('test');
  });

  // ── 综合测试 (2 个) ──

  it('混合全角路径检测', () => {
    const r = detectUnicodeConfusion('/\uFF55\uFF53\uFF52/\uFF42\uFF49\uFF4E/\uFF52\uFF4D'); // /ｕｓｒ/ｂｉｎ/ｒｍ
    expect(r.detected).toBe(true);
    expect(r.normalized).toBe('/usr/bin/rm');
  });

  it('隐形字符路径检测', () => {
    const r = detectUnicodeConfusion('/etc/\u200Bpasswd');
    expect(r.detected).toBe(true);
    expect(r.issues.some(i => i.includes('零宽空格'))).toBe(true);
    expect(r.normalized).toBe('/etc/passwd');
  });
});
