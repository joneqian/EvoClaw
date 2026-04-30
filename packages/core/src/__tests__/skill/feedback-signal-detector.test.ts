/**
 * P1-B Phase 1: 用户负反馈信号检测器单测
 *
 * 覆盖：
 * - 中文 / 英文强信号模式
 * - 假阳性（"不要紧" / "don't worry" 等日常用法不命中）
 * - 关联到最近 skill（窗口边界 / 多候选取最近）
 * - 空输入 / 无 skill 上下文 / 超出窗口 → 'none'
 */

import { describe, it, expect } from 'vitest';
import { detectFeedbackSignal } from '../../skill/feedback-signal-detector.js';

const NOW = new Date('2026-04-30T12:00:00Z');

function usage(skillName: string, ageSec: number) {
  return {
    skillName,
    invokedAt: new Date(NOW.getTime() - ageSec * 1000).toISOString(),
  };
}

describe('detectFeedbackSignal — 中文强信号', () => {
  it.each([
    ['不要这样', '不要这样'],
    ['你别这样回答', '别这样'],
    ['不要再这么写了', '不要再'],
    ['我说过别这么干', '说过'],
    ['怎么又错了', '怎么又'],
    ['你又搞错了', '又搞错'],
    ['这完全错了', '完全错'],
    ['真讨厌你这种回答', '讨厌'],
    ['不喜欢这样', '不喜欢'],
    ['搞砸了', '搞砸'],
  ])('"%s" → strong（包含 %s）', (msg, _kw) => {
    const r = detectFeedbackSignal({
      userMessage: msg,
      recentSkillUsages: [usage('git-commit', 30)],
      now: NOW,
    });
    expect(r.signal).toBe('strong');
    expect(r.skillName).toBe('git-commit');
    expect(r.evidence).toBe(msg);
  });
});

describe('detectFeedbackSignal — 英文强信号', () => {
  it.each([
    "stop doing that",
    "stop it",
    "don't do that",
    "do not do that again",
    "I told you not to",
    "I hate when you do this",
    "you keep doing this wrong",
    "wrong again",
    "not like that",
  ])('"%s" → strong', (msg) => {
    const r = detectFeedbackSignal({
      userMessage: msg,
      recentSkillUsages: [usage('git-commit', 30)],
      now: NOW,
    });
    expect(r.signal).toBe('strong');
    expect(r.skillName).toBe('git-commit');
  });
});

describe('detectFeedbackSignal — 假阳性（不应触发）', () => {
  it.each([
    '不要紧，我自己来',
    '别担心，没事的',
    '帮我别名一下这个变量',
    '请讨论一下方案',
    "don't worry about it",
    'I stopped using that approach',
    "let's stop here for today",
    '我又遇到这个 bug 了',
    '继续这样做',
    '完成了',
  ])('"%s" → none', (msg) => {
    const r = detectFeedbackSignal({
      userMessage: msg,
      recentSkillUsages: [usage('git-commit', 30)],
      now: NOW,
    });
    expect(r.signal).toBe('none');
    expect(r.skillName).toBeUndefined();
  });
});

describe('detectFeedbackSignal — skill 关联', () => {
  it('无最近 skill 调用 → none（即使命中模式）', () => {
    const r = detectFeedbackSignal({
      userMessage: '不要这样',
      recentSkillUsages: [],
      now: NOW,
    });
    expect(r.signal).toBe('none');
  });

  it('多个候选 → 取最近一条', () => {
    const r = detectFeedbackSignal({
      userMessage: '不要这样',
      recentSkillUsages: [
        usage('older-skill', 240),  // 4 分钟前
        usage('latest-skill', 30),  // 30 秒前
        usage('middle-skill', 120), // 2 分钟前
      ],
      now: NOW,
    });
    expect(r.signal).toBe('strong');
    expect(r.skillName).toBe('latest-skill');
  });

  it('窗口外 → none（默认 5 分钟）', () => {
    const r = detectFeedbackSignal({
      userMessage: '不要这样',
      recentSkillUsages: [usage('git-commit', 600)], // 10 分钟前
      now: NOW,
    });
    expect(r.signal).toBe('none');
  });

  it('自定义窗口可拉宽', () => {
    const r = detectFeedbackSignal({
      userMessage: '不要这样',
      recentSkillUsages: [usage('git-commit', 600)],
      now: NOW,
      windowMinutes: 15,
    });
    expect(r.signal).toBe('strong');
    expect(r.skillName).toBe('git-commit');
  });
});

describe('detectFeedbackSignal — 边界', () => {
  it('空消息 → none', () => {
    const r = detectFeedbackSignal({
      userMessage: '',
      recentSkillUsages: [usage('git-commit', 10)],
      now: NOW,
    });
    expect(r.signal).toBe('none');
  });

  it('纯空白 → none', () => {
    const r = detectFeedbackSignal({
      userMessage: '   \n\t  ',
      recentSkillUsages: [usage('git-commit', 10)],
      now: NOW,
    });
    expect(r.signal).toBe('none');
  });

  it('超长消息 evidence 截断到 200 字', () => {
    const longMsg = '不要这样' + '啊'.repeat(500);
    const r = detectFeedbackSignal({
      userMessage: longMsg,
      recentSkillUsages: [usage('git-commit', 10)],
      now: NOW,
    });
    expect(r.signal).toBe('strong');
    expect(r.evidence).toBeDefined();
    expect(r.evidence!.length).toBeLessThanOrEqual(200);
  });

  it('matchedPattern 暴露命中规则用于审计', () => {
    const r = detectFeedbackSignal({
      userMessage: '不要这样',
      recentSkillUsages: [usage('git-commit', 10)],
      now: NOW,
    });
    expect(r.matchedPattern).toBeTruthy();
    expect(typeof r.matchedPattern).toBe('string');
  });
});
