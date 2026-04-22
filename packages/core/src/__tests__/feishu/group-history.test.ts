/**
 * 飞书群聊旁听缓冲（GroupHistoryBuffer）单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GroupHistoryBuffer,
  DEFAULT_GROUP_HISTORY_CONFIG,
  buildHistoryKey,
  formatGroupHistoryContext,
  type GroupHistoryEntry,
  type GroupHistoryConfig,
} from '../../channel/adapters/feishu/group-history.js';

function makeEntry(overrides: Partial<GroupHistoryEntry> = {}): GroupHistoryEntry {
  return {
    sender: 'ou_alice',
    senderName: '爱丽丝',
    body: '你好',
    timestamp: Date.now(),
    messageId: `om_${Math.random().toString(36).slice(2, 8)}`,
    fromBot: false,
    ...overrides,
  };
}

function withConfig(overrides: Partial<GroupHistoryConfig> = {}): GroupHistoryConfig {
  return { ...DEFAULT_GROUP_HISTORY_CONFIG, ...overrides };
}

describe('buildHistoryKey', () => {
  it('仅 chatId → chatId 原样', () => {
    expect(buildHistoryKey({ chatId: 'oc_x' })).toBe('oc_x');
  });

  it('带 threadId → chatId:topic:threadId', () => {
    expect(buildHistoryKey({ chatId: 'oc_x', threadId: 't1' })).toBe('oc_x:topic:t1');
  });

  it('chatId 空字符串 → 空串', () => {
    expect(buildHistoryKey({ chatId: '' })).toBe('');
  });
});

describe('GroupHistoryBuffer.record/peek', () => {
  let buffer: GroupHistoryBuffer;

  beforeEach(() => {
    buffer = new GroupHistoryBuffer();
  });

  it('enabled=false 时不记录', () => {
    buffer.record('k1', makeEntry(), withConfig({ enabled: false }));
    expect(buffer.peek('k1', withConfig())).toEqual([]);
  });

  it('limit=0 时不记录', () => {
    buffer.record('k1', makeEntry(), withConfig({ limit: 0 }));
    expect(buffer.peek('k1', withConfig())).toEqual([]);
  });

  it('空 historyKey 不记录', () => {
    buffer.record('', makeEntry(), withConfig());
    expect(buffer.size()).toBe(0);
  });

  it('record / peek 基本流程', () => {
    const entry = makeEntry({ body: '我来了' });
    buffer.record('k1', entry, withConfig());
    const result = buffer.peek('k1', withConfig());
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe('我来了');
  });

  it('不同 historyKey 互不干扰', () => {
    buffer.record('k1', makeEntry({ body: 'A' }), withConfig());
    buffer.record('k2', makeEntry({ body: 'B' }), withConfig());
    expect(buffer.peek('k1', withConfig())).toHaveLength(1);
    expect(buffer.peek('k2', withConfig())).toHaveLength(1);
    expect(buffer.peek('k1', withConfig())[0]!.body).toBe('A');
    expect(buffer.peek('k2', withConfig())[0]!.body).toBe('B');
  });

  it('同 messageId 重复记录只保留一条', () => {
    const cfg = withConfig();
    buffer.record('k1', makeEntry({ messageId: 'om_same', body: '第一次' }), cfg);
    buffer.record('k1', makeEntry({ messageId: 'om_same', body: '第二次' }), cfg);
    const res = buffer.peek('k1', cfg);
    expect(res).toHaveLength(1);
    expect(res[0]!.body).toBe('第一次');
  });

  it('超过 limit 时 FIFO 淘汰最旧', () => {
    const cfg = withConfig({ limit: 3 });
    for (let i = 0; i < 5; i++) {
      buffer.record(
        'k1',
        makeEntry({ messageId: `om_${i}`, body: `msg${i}`, timestamp: Date.now() + i }),
        cfg,
      );
    }
    const res = buffer.peek('k1', cfg);
    expect(res).toHaveLength(3);
    expect(res.map((e) => e.body)).toEqual(['msg2', 'msg3', 'msg4']);
  });

  it('peek 返回的 limit 根据 config（不能超过实际条目数）', () => {
    const cfg = withConfig({ limit: 20 });
    for (let i = 0; i < 5; i++) {
      buffer.record('k1', makeEntry({ messageId: `m${i}`, body: `b${i}` }), cfg);
    }
    const res = buffer.peek('k1', cfg);
    expect(res).toHaveLength(5);
  });
});

describe('GroupHistoryBuffer TTL 懒淘汰', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('peek 时过期条目被丢弃', () => {
    const buffer = new GroupHistoryBuffer();
    const cfg = withConfig({ ttlMinutes: 10 });

    // 30 分钟前的条目（远超 TTL）
    buffer.record(
      'k1',
      makeEntry({ messageId: 'old', body: '旧', timestamp: Date.now() - 30 * 60_000 }),
      cfg,
    );
    // 当下条目
    buffer.record('k1', makeEntry({ messageId: 'new', body: '新' }), cfg);

    const res = buffer.peek('k1', cfg);
    expect(res).toHaveLength(1);
    expect(res[0]!.body).toBe('新');
  });

  it('record 时也执行懒淘汰（长度不会因过期条目占位而爆）', () => {
    const buffer = new GroupHistoryBuffer();
    const cfg = withConfig({ ttlMinutes: 5, limit: 3 });

    // 3 条过期条目
    for (let i = 0; i < 3; i++) {
      buffer.record(
        'k1',
        makeEntry({
          messageId: `old${i}`,
          body: `o${i}`,
          timestamp: Date.now() - 10 * 60_000 - i,
        }),
        cfg,
      );
    }
    // 向前推 20 分钟后再记一条新条目
    vi.advanceTimersByTime(20 * 60_000);
    buffer.record('k1', makeEntry({ messageId: 'new', body: '新' }), cfg);

    const res = buffer.peek('k1', cfg);
    expect(res).toHaveLength(1);
    expect(res[0]!.body).toBe('新');
  });

  it('ttlMinutes=0 视为不限过期（仅 limit 生效）', () => {
    const buffer = new GroupHistoryBuffer();
    const cfg = withConfig({ ttlMinutes: 0, limit: 5 });
    buffer.record(
      'k1',
      makeEntry({ messageId: 'ancient', body: '远古', timestamp: Date.now() - 100 * 60_000 }),
      cfg,
    );
    expect(buffer.peek('k1', cfg)).toHaveLength(1);
  });
});

describe('GroupHistoryBuffer.clear', () => {
  it('clear(key) 只清该 key', () => {
    const buffer = new GroupHistoryBuffer();
    buffer.record('k1', makeEntry(), withConfig());
    buffer.record('k2', makeEntry(), withConfig());
    buffer.clear('k1');
    expect(buffer.peek('k1', withConfig())).toEqual([]);
    expect(buffer.peek('k2', withConfig())).toHaveLength(1);
  });

  it('clear() 无参数清空全部', () => {
    const buffer = new GroupHistoryBuffer();
    buffer.record('k1', makeEntry(), withConfig());
    buffer.record('k2', makeEntry(), withConfig());
    buffer.clear();
    expect(buffer.size()).toBe(0);
  });
});

describe('formatGroupHistoryContext', () => {
  it('entries 为空时原样返回 currentMessage', () => {
    const out = formatGroupHistoryContext({ entries: [], currentMessage: '你好' });
    expect(out).toBe('你好');
  });

  it('多条时输出含前情提要 + 当前消息两段', () => {
    const entries: GroupHistoryEntry[] = [
      makeEntry({
        sender: 'ou_alice',
        senderName: '爱丽丝',
        body: '需求是 X',
        timestamp: new Date('2026-04-22T10:05:00').getTime(),
        messageId: 'm1',
        fromBot: false,
      }),
      makeEntry({
        sender: 'ou_bot_a',
        senderName: 'Agent-A',
        body: '收到，评估中',
        timestamp: new Date('2026-04-22T10:06:00').getTime(),
        messageId: 'm2',
        fromBot: true,
      }),
    ];
    const out = formatGroupHistoryContext({
      entries,
      currentMessage: '爱丽丝: 帮我看下 Agent-A 的结论',
    });
    expect(out).toContain('[群聊前情提要（最近 2 条，不含本条）]');
    expect(out).toContain('爱丽丝：需求是 X');
    expect(out).toContain('Agent-A（机器人）：收到，评估中');
    expect(out).toContain('[当前 @ 你的消息]');
    expect(out).toContain('爱丽丝: 帮我看下 Agent-A 的结论');
    expect(out).toMatch(/\[\d{2}:\d{2}\]/);
  });

  it('body 内换行会被压缩为空格，不破坏列表格式', () => {
    const entries = [
      makeEntry({
        senderName: '鲍勃',
        body: '第一行\n第二行\r\n第三行',
        fromBot: false,
      }),
    ];
    const out = formatGroupHistoryContext({ entries, currentMessage: '现在' });
    expect(out).toContain('鲍勃：第一行 第二行 第三行');
    expect(out).not.toContain('第一行\n第二行');
  });

  it('缺 senderName 时用 sender id 兜底', () => {
    const entries = [makeEntry({ senderName: undefined, sender: 'ou_xyz', body: 'hi' })];
    const out = formatGroupHistoryContext({ entries, currentMessage: '当前' });
    expect(out).toContain('ou_xyz：hi');
  });
});
