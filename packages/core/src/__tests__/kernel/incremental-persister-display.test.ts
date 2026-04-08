/**
 * incremental-persister 显示文本提取单测
 *
 * 覆盖 extractDisplayContent / reconstructDisplayContent 的 fallback 策略，
 * 防止 [xxx message with N blocks] 占位符 bug 再现。
 */

import { describe, it, expect } from 'vitest';
import {
  extractDisplayContent,
  reconstructDisplayContent,
  shouldDisplayMessage,
  extractTextOnly,
  extractToolCallsForUI,
} from '../../agent/kernel/incremental-persister.js';
import type { KernelMessage } from '../../agent/kernel/types.js';

function makeMsg(
  role: 'user' | 'assistant',
  content: KernelMessage['content'],
): KernelMessage {
  return {
    id: 'msg-1',
    role,
    content,
  } as KernelMessage;
}

describe('extractDisplayContent', () => {
  it('有 text 块应返回拼接的 text 内容', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: '你好' },
      { type: 'text', text: '世界' },
    ]);
    expect(extractDisplayContent(msg)).toBe('你好\n世界');
  });

  it('空 text 块应被过滤', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: '' },
      { type: 'text', text: '   ' },
      { type: 'text', text: '真实内容' },
    ]);
    expect(extractDisplayContent(msg)).toBe('真实内容');
  });

  it('只有 thinking 块应返回思考摘要', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '用户要我派 3 个子 agent...' } as any,
    ]);
    const result = extractDisplayContent(msg);
    expect(result).toContain('[思考]');
    expect(result).toContain('用户要我派 3 个子 agent');
  });

  it('只有 tool_use 块应返回工具调用摘要', () => {
    const msg = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu1', name: 'spawn_agent', input: { task: '背静夜思' } } as any,
    ]);
    const result = extractDisplayContent(msg);
    expect(result).toBe('[调用 spawn_agent] 背静夜思');
  });

  it('thinking + 多个 tool_use 应用 · 分隔', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '需要并行执行' } as any,
      { type: 'tool_use', id: 'tu1', name: 'spawn_agent', input: { task: '任务 A' } } as any,
      { type: 'tool_use', id: 'tu2', name: 'spawn_agent', input: { task: '任务 B' } } as any,
    ]);
    const result = extractDisplayContent(msg);
    expect(result).toContain('[思考]');
    expect(result).toContain('[调用 spawn_agent] 任务 A');
    expect(result).toContain('[调用 spawn_agent] 任务 B');
    expect(result).toContain(' · ');
  });

  it('tool_result 块应返回工具结果摘要', () => {
    const msg = makeMsg('user', [
      { type: 'tool_result', tool_use_id: 'tu1', content: '执行成功，输出 42' } as any,
    ]);
    expect(extractDisplayContent(msg)).toBe('[工具结果] 执行成功，输出 42');
  });

  it('is_error tool_result 应标记为工具错误', () => {
    const msg = makeMsg('user', [
      { type: 'tool_result', tool_use_id: 'tu1', content: '文件不存在', is_error: true } as any,
    ]);
    expect(extractDisplayContent(msg)).toContain('[工具错误]');
  });

  it('image 块应返回占位', () => {
    const msg = makeMsg('user', [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } } as any,
    ]);
    expect(extractDisplayContent(msg)).toBe('[图片]');
  });

  it('redacted_thinking 应返回 [思考] 占位', () => {
    const msg = makeMsg('assistant', [
      { type: 'redacted_thinking', data: 'opaque' } as any,
    ]);
    expect(extractDisplayContent(msg)).toBe('[思考]');
  });

  it('tool_use 的参数应按优先级选字段（task > command > file_path > query）', () => {
    const msg1 = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu1', name: 'bash', input: { command: 'ls -la', timeout: 5000 } } as any,
    ]);
    expect(extractDisplayContent(msg1)).toBe('[调用 bash] ls -la');

    const msg2 = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu2', name: 'read', input: { file_path: '/etc/passwd' } } as any,
    ]);
    expect(extractDisplayContent(msg2)).toBe('[调用 read] /etc/passwd');

    const msg3 = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu3', name: 'web_search', input: { query: 'TypeScript generics' } } as any,
    ]);
    expect(extractDisplayContent(msg3)).toBe('[调用 web_search] TypeScript generics');
  });

  it('超长 tool_use 参数应截断', () => {
    const longTask = 'a'.repeat(200);
    const msg = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu1', name: 'spawn_agent', input: { task: longTask } } as any,
    ]);
    const result = extractDisplayContent(msg);
    expect(result.length).toBeLessThan(longTask.length + 20);
    expect(result).toContain('…');
  });

  it('空 content 数组应返回空字符串', () => {
    const msg = makeMsg('assistant', []);
    expect(extractDisplayContent(msg)).toBe('');
  });

  it('text 优先于其他块类型', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '思考中' } as any,
      { type: 'text', text: '最终答案' },
      { type: 'tool_use', id: 'tu1', name: 'bash', input: { command: 'ls' } } as any,
    ]);
    // 有 text 块时应该只返回 text 内容
    expect(extractDisplayContent(msg)).toBe('最终答案');
  });

  it('绝不返回 [xxx message with N blocks] 占位符', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: 'x' } as any,
      { type: 'tool_use', id: 'tu', name: 'bash', input: {} } as any,
    ]);
    const result = extractDisplayContent(msg);
    expect(result).not.toMatch(/\[\w+ message with \d+ blocks\]/);
  });
});

describe('reconstructDisplayContent', () => {
  it('非占位符内容应原样返回', () => {
    expect(reconstructDisplayContent('正常消息', null)).toBe('正常消息');
    expect(reconstructDisplayContent('正常消息', 'invalid json')).toBe('正常消息');
  });

  it('占位符 + 有效 JSON 应重建为摘要', () => {
    const msg: KernelMessage = {
      id: 'm1',
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu1', name: 'spawn_agent', input: { task: '背静夜思' } } as any,
      ],
    } as KernelMessage;
    const reconstructed = reconstructDisplayContent(
      '[assistant message with 1 blocks]',
      JSON.stringify(msg),
    );
    expect(reconstructed).toBe('[调用 spawn_agent] 背静夜思');
  });

  it('占位符 + null JSON 应原样返回占位符', () => {
    expect(
      reconstructDisplayContent('[assistant message with 3 blocks]', null),
    ).toBe('[assistant message with 3 blocks]');
  });

  it('占位符 + 损坏 JSON 应原样返回占位符', () => {
    expect(
      reconstructDisplayContent('[assistant message with 3 blocks]', '{bad'),
    ).toBe('[assistant message with 3 blocks]');
  });

  it('占位符 + 空 content JSON 应原样返回占位符（fallback 失败不覆盖原文本）', () => {
    const emptyMsg: KernelMessage = {
      id: 'm1',
      role: 'assistant',
      content: [],
    } as KernelMessage;
    expect(
      reconstructDisplayContent('[assistant message with 0 blocks]', JSON.stringify(emptyMsg)),
    ).toBe('[assistant message with 0 blocks]');
  });

  it('识别 user 和 assistant 两种角色的占位符', () => {
    const msg: KernelMessage = {
      id: 'm1',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu', content: '成功' } as any],
    } as KernelMessage;
    expect(
      reconstructDisplayContent('[user message with 1 blocks]', JSON.stringify(msg)),
    ).toBe('[工具结果] 成功');
  });

  it('匹配带前后空格的占位符', () => {
    const msg: KernelMessage = {
      id: 'm1',
      role: 'assistant',
      content: [{ type: 'thinking', thinking: '思考' } as any],
    } as KernelMessage;
    expect(
      reconstructDisplayContent('  [assistant message with 1 blocks]  ', JSON.stringify(msg)),
    ).toBe('[思考] 思考');
  });

  it('空字符串应原样返回', () => {
    expect(reconstructDisplayContent('', null)).toBe('');
  });
});

describe('shouldDisplayMessage', () => {
  it('纯 text 消息应展示', () => {
    const msg = makeMsg('assistant', [{ type: 'text', text: '你好' }]);
    expect(shouldDisplayMessage(msg)).toBe(true);
  });

  it('含 tool_use 的 assistant 消息应展示', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '...' } as any,
      { type: 'tool_use', id: 'tu', name: 'bash', input: {} } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(true);
  });

  it('纯 tool_result 消息（role=user）应过滤', () => {
    const msg = makeMsg('user', [
      { type: 'tool_result', tool_use_id: 'tu', content: '成功' } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(false);
  });

  it('多个 tool_result 块应过滤', () => {
    const msg = makeMsg('user', [
      { type: 'tool_result', tool_use_id: 'tu1', content: '结果 1' } as any,
      { type: 'tool_result', tool_use_id: 'tu2', content: '结果 2' } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(false);
  });

  it('纯 thinking 消息应过滤', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '思考中' } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(false);
  });

  it('纯 redacted_thinking 应过滤', () => {
    const msg = makeMsg('assistant', [
      { type: 'redacted_thinking', data: 'x' } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(false);
  });

  it('空 content 数组应过滤', () => {
    const msg = makeMsg('assistant', []);
    expect(shouldDisplayMessage(msg)).toBe(false);
  });

  it('image 块应展示', () => {
    const msg = makeMsg('user', [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(true);
  });

  it('混合 text + tool_result 应展示', () => {
    const msg = makeMsg('user', [
      { type: 'text', text: '用户消息' },
      { type: 'tool_result', tool_use_id: 'tu', content: '结果' } as any,
    ]);
    expect(shouldDisplayMessage(msg)).toBe(true);
  });
});

describe('extractTextOnly', () => {
  it('只返回 text 块的拼接', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '思考' } as any,
      { type: 'text', text: '最终答案' },
      { type: 'tool_use', id: 'tu', name: 'bash', input: { command: 'ls' } } as any,
    ]);
    expect(extractTextOnly(msg)).toBe('最终答案');
  });

  it('无 text 块应返回空字符串', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: '思考' } as any,
      { type: 'tool_use', id: 'tu', name: 'bash', input: {} } as any,
    ]);
    expect(extractTextOnly(msg)).toBe('');
  });

  it('多个 text 块应用换行连接', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: '第一段' },
      { type: 'tool_use', id: 'tu', name: 'bash', input: {} } as any,
      { type: 'text', text: '第二段' },
    ]);
    expect(extractTextOnly(msg)).toBe('第一段\n第二段');
  });

  it('空白 text 块应被过滤', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: '   ' },
      { type: 'text', text: '真实内容' },
      { type: 'text', text: '' },
    ]);
    expect(extractTextOnly(msg)).toBe('真实内容');
  });
});

describe('extractToolCallsForUI', () => {
  it('从 tool_use 块生成前端 ToolCall 数组', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: '我派 3 个子 agent' },
      { type: 'tool_use', id: 'tu1', name: 'spawn_agent', input: { task: '背静夜思' } } as any,
      { type: 'tool_use', id: 'tu2', name: 'spawn_agent', input: { task: '背春望' } } as any,
    ]);
    const calls = extractToolCallsForUI(msg);
    expect(calls).toHaveLength(2);
    expect(calls![0]).toEqual({ name: 'spawn_agent', status: 'done', summary: '背静夜思' });
    expect(calls![1]).toEqual({ name: 'spawn_agent', status: 'done', summary: '背春望' });
  });

  it('所有历史 toolCalls 状态都是 done', () => {
    const msg = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu', name: 'bash', input: { command: 'ls' } } as any,
    ]);
    const calls = extractToolCallsForUI(msg);
    expect(calls![0]!.status).toBe('done');
  });

  it('无参数的工具调用 summary 应省略', () => {
    const msg = makeMsg('assistant', [
      { type: 'tool_use', id: 'tu', name: 'list_agents', input: {} } as any,
    ]);
    const calls = extractToolCallsForUI(msg);
    expect(calls![0]).toEqual({ name: 'list_agents', status: 'done' });
    expect(calls![0]).not.toHaveProperty('summary');
  });

  it('无 tool_use 块应返回 undefined', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: '纯文本回答' },
      { type: 'thinking', thinking: '思考' } as any,
    ]);
    expect(extractToolCallsForUI(msg)).toBeUndefined();
  });

  it('空 content 应返回 undefined', () => {
    const msg = makeMsg('assistant', []);
    expect(extractToolCallsForUI(msg)).toBeUndefined();
  });
});
