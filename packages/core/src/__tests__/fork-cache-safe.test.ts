import { describe, it, expect } from 'vitest';
import { buildCacheSafeForkedMessages, isInForkChild } from '../agent/sub-agent-spawner.js';
import type { ChatMessage } from '@evoclaw/shared';

/** 创建测试消息 */
function msg(role: ChatMessage['role'], content: string, id?: string): ChatMessage {
  return {
    id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: 'conv-1',
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

describe('buildCacheSafeForkedMessages', () => {
  it('复制最近父消息并追加 fork 指令', () => {
    const parentMsgs: ChatMessage[] = [
      msg('user', '帮我分析代码'),
      msg('assistant', '好的，我来分析'),
      msg('user', '重点看安全问题'),
    ];

    const result = buildCacheSafeForkedMessages(parentMsgs, '检查 auth 模块的安全漏洞');

    // 应包含 3 条父消息 + 1 条 fork 指令
    expect(result).toHaveLength(4);
    // 前 3 条应与父消息一致
    expect(result[0]!.content).toBe('帮我分析代码');
    expect(result[1]!.content).toBe('好的，我来分析');
    expect(result[2]!.content).toBe('重点看安全问题');
    // 最后一条应包含 fork 标记和指令
    expect(result[3]!.role).toBe('user');
    expect(result[3]!.content).toContain('<fork-boilerplate>');
    expect(result[3]!.content).toContain('<fork-directive>检查 auth 模块的安全漏洞</fork-directive>');
  });

  it('限制最多 10 条父消息', () => {
    const parentMsgs: ChatMessage[] = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `消息 ${i}`),
    );

    const result = buildCacheSafeForkedMessages(parentMsgs, '任务');

    // 10 条父消息 + 1 条 fork 指令 = 11
    expect(result).toHaveLength(11);
    // 应取最后 10 条（索引 10-19）
    expect(result[0]!.content).toBe('消息 10');
    expect(result[9]!.content).toBe('消息 19');
  });

  it('空父消息时仅包含 fork 指令', () => {
    const result = buildCacheSafeForkedMessages([], '独立任务');

    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('user');
    expect(result[0]!.content).toContain('<fork-directive>独立任务</fork-directive>');
  });

  it('fork 指令消息包含结构化输出模板', () => {
    const result = buildCacheSafeForkedMessages([], '分析性能');
    const directive = result[0]!.content;

    expect(directive).toContain('Scope:');
    expect(directive).toContain('Result:');
    expect(directive).toContain('Key files:');
    expect(directive).toContain('Changes:');
    expect(directive).toContain('Issues:');
  });

  it('fork 指令消息有有效的 ChatMessage 字段', () => {
    const result = buildCacheSafeForkedMessages([], '任务');
    const forkMsg = result[0]!;

    expect(forkMsg.id).toBeTruthy();
    expect(forkMsg.conversationId).toBe('');
    expect(forkMsg.createdAt).toBeTruthy();
  });

  it('父消息中有 conversationId 时 fork 消息继承', () => {
    const parentMsgs = [msg('user', '你好', 'msg-1')];
    parentMsgs[0]!.conversationId = 'conv-parent-123';

    const result = buildCacheSafeForkedMessages(parentMsgs, '任务');
    expect(result[1]!.conversationId).toBe('conv-parent-123');
  });
});

describe('isInForkChild', () => {
  it('检测到 fork 标记返回 true', () => {
    const messages = [
      { role: 'user', content: '<fork-boilerplate>\n你是一个 Fork Worker' },
    ];
    expect(isInForkChild(messages)).toBe(true);
  });

  it('无 fork 标记返回 false', () => {
    const messages = [
      { role: 'user', content: '帮我分析代码' },
      { role: 'assistant', content: '好的' },
    ];
    expect(isInForkChild(messages)).toBe(false);
  });

  it('assistant 消息中的标记不算（仅检测 user）', () => {
    const messages = [
      { role: 'assistant', content: '我看到了 <fork-boilerplate> 标记' },
    ];
    expect(isInForkChild(messages)).toBe(false);
  });

  it('空消息列表返回 false', () => {
    expect(isInForkChild([])).toBe(false);
  });
});
