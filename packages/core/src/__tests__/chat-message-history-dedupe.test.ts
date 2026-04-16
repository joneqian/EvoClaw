/**
 * loadMessageHistory 去重单测
 *
 * 覆盖 assistant 消息被 saveMessage + IncrementalPersister 双写的去重逻辑。
 * 保证：
 * - 混合 session（persister + 冗余 saveMessage）只保留 persister 的 row
 * - 纯老 session（全部 saveMessage）原样保留，不误删合法数据
 * - user 消息不受去重影响
 */

import { describe, it, expect } from 'vitest';

/** 简化的行类型（和 chat.ts 内部类型一致） */
interface Row {
  id: string;
  role: string;
  content: string;
  kernel_message_json: string | null;
}

/** 复制 chat.ts 的去重函数行为用于独立测试 */
function dedupeAssistantRows(rows: Row[]): Row[] {
  const hasPersisterAssistant = rows.some(
    r => r.role === 'assistant' && r.kernel_message_json !== null,
  );
  if (!hasPersisterAssistant) return rows;
  return rows.filter(
    r => !(r.role === 'assistant' && r.kernel_message_json === null),
  );
}

describe('dedupeAssistantRows', () => {
  it('混合 session：丢弃冗余 saveMessage 行，保留 persister 行', () => {
    const rows: Row[] = [
      { id: 'u1', role: 'user', content: '你好', kernel_message_json: null },
      { id: 'a1', role: 'assistant', content: '你好张三', kernel_message_json: '{"id":"m1","role":"assistant","content":[]}' },
      { id: 'a2', role: 'assistant', content: '你好张三', kernel_message_json: null }, // saveMessage 冗余
    ];
    const result = dedupeAssistantRows(rows);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual(['u1', 'a1']);
  });

  it('纯老 session：全部是 saveMessage 行，原样保留', () => {
    const rows: Row[] = [
      { id: 'u1', role: 'user', content: '老问题', kernel_message_json: null },
      { id: 'a1', role: 'assistant', content: '老回答 1', kernel_message_json: null },
      { id: 'u2', role: 'user', content: '追问', kernel_message_json: null },
      { id: 'a2', role: 'assistant', content: '老回答 2', kernel_message_json: null },
    ];
    const result = dedupeAssistantRows(rows);
    expect(result).toHaveLength(4);
    expect(result).toEqual(rows);
  });

  it('纯新 session：全部是 persister 行，原样保留', () => {
    const rows: Row[] = [
      { id: 'u1', role: 'user', content: '新问题', kernel_message_json: null },
      { id: 'a1', role: 'assistant', content: 'turn 1', kernel_message_json: '{"id":"m1","role":"assistant","content":[]}' },
      { id: 'u2', role: 'user', content: '', kernel_message_json: '{"id":"m2","role":"user","content":[{"type":"tool_result"}]}' },
      { id: 'a2', role: 'assistant', content: 'turn 2', kernel_message_json: '{"id":"m3","role":"assistant","content":[]}' },
    ];
    const result = dedupeAssistantRows(rows);
    expect(result).toHaveLength(4);
    expect(result).toEqual(rows);
  });

  it('user 消息不受去重影响', () => {
    const rows: Row[] = [
      { id: 'u1', role: 'user', content: '你好', kernel_message_json: null },
      { id: 'u2', role: 'user', content: '', kernel_message_json: '{"tool_result":"..."}' },
      { id: 'a1', role: 'assistant', content: '回答', kernel_message_json: '{"persisted":true}' },
    ];
    const result = dedupeAssistantRows(rows);
    // 所有 user 行都应保留
    expect(result.filter(r => r.role === 'user')).toHaveLength(2);
    expect(result.find(r => r.id === 'a1')).toBeDefined();
  });

  it('多轮 session + 最后的 saveMessage 冗余行', () => {
    // 模拟实际场景：query-loop 运行 5 个 turn，每个 turn 存 1 条 assistant row，
    // 最后 saveMessage 又存一条 cleanResponse（重复）
    const rows: Row[] = [
      { id: 'u0', role: 'user', content: '用户问题', kernel_message_json: null },
      { id: 'a-turn-0', role: 'assistant', content: 'turn 0 text', kernel_message_json: '{"id":"m0"}' },
      { id: 'u-tool-1', role: 'user', content: '', kernel_message_json: '{"tool_result":"r1"}' },
      { id: 'a-turn-2', role: 'assistant', content: 'turn 2 text', kernel_message_json: '{"id":"m2"}' },
      { id: 'u-tool-3', role: 'user', content: '', kernel_message_json: '{"tool_result":"r3"}' },
      { id: 'a-turn-4', role: 'assistant', content: 'final text', kernel_message_json: '{"id":"m4"}' },
      { id: 'a-save-redundant', role: 'assistant', content: 'final text (merged)', kernel_message_json: null }, // ← 冗余
    ];
    const result = dedupeAssistantRows(rows);
    expect(result).toHaveLength(6); // 7 - 1 冗余
    expect(result.find(r => r.id === 'a-save-redundant')).toBeUndefined();
    // 所有 persister 行都保留
    expect(result.filter(r => r.role === 'assistant')).toHaveLength(3);
  });

  it('空数组应原样返回', () => {
    expect(dedupeAssistantRows([])).toEqual([]);
  });

  it('只有 user 消息的 session 应原样返回', () => {
    const rows: Row[] = [
      { id: 'u1', role: 'user', content: '你好', kernel_message_json: null },
    ];
    expect(dedupeAssistantRows(rows)).toEqual(rows);
  });
});
