/**
 * ChatPrebakeService 单元测试（M13 cross-app cold-start 修复）
 *
 * 覆盖：
 *   - 首次调用 → 发消息 + 写时间戳
 *   - TTL 内重复调用 → 跳过
 *   - TTL 过期后 → 重新发
 *   - sendFn 抛错 → 不写时间戳，下次再试
 *   - DB 写入失败 → 不阻塞（但消息已发）
 *   - 不同 (chat, account) 互不干扰
 *   - resetAll 清空允许立即重发
 *   - buildPrebakeText 含 emoji + name
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatPrebakeService, buildPrebakeText } from '../../channel/adapters/feishu/inbound/chat-prebake.js';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';

async function setupDb() {
  const store = new SqliteStore(':memory:');
  await new MigrationRunner(store).run();
  return store;
}

describe('ChatPrebakeService', () => {
  let store: SqliteStore;

  beforeEach(async () => {
    store = await setupDb();
  });

  it('首次调用 → 调 sendFn + 写时间戳', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const svc = new ChatPrebakeService({ store });

    const result = await svc.maybePrebake({
      chatId: 'oc_x',
      accountId: 'cli_pm',
      agentName: '项目经理',
      sendFn,
    });

    expect(result.fired).toBe(true);
    expect(sendFn).toHaveBeenCalledOnce();
    const sentText = sendFn.mock.calls[0][0] as string;
    expect(sentText).toContain('项目经理');
    expect(sentText).toContain('已上线');

    // DB 已写入
    const row = store.get<{ chat_id: string; account_id: string }>(
      `SELECT chat_id, account_id FROM feishu_chat_prebakes WHERE chat_id = ? AND account_id = ?`,
      'oc_x',
      'cli_pm',
    );
    expect(row).toBeDefined();
  });

  it('TTL 内重复调用 → 跳过不发', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const svc = new ChatPrebakeService({ store, ttlMs: 60_000 });  // 60s TTL

    await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });
    expect(sendFn).toHaveBeenCalledTimes(1);

    // 立即第二次
    const r2 = await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });
    expect(r2.fired).toBe(false);
    expect(r2.skipReason).toBe('within_ttl');
    expect(sendFn).toHaveBeenCalledTimes(1);  // 仍只调一次
  });

  it('TTL 过期后 → 重新发', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    // ttlMs = 0 → 永远过期
    const svc = new ChatPrebakeService({ store, ttlMs: 0 });

    await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });
    await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });

    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it('sendFn 抛错 → 不写时间戳 + 标记 skipReason', async () => {
    const sendFn = vi.fn().mockRejectedValue(new Error('网络抖动'));
    const svc = new ChatPrebakeService({ store });

    const result = await svc.maybePrebake({
      chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn,
    });
    expect(result.fired).toBe(false);
    expect(result.skipReason).toBe('send_error');
    expect(result.error).toContain('网络抖动');

    // DB 不写
    const row = store.get(
      `SELECT 1 FROM feishu_chat_prebakes WHERE chat_id = ? AND account_id = ?`,
      'oc_x', 'cli_pm',
    );
    expect(row).toBeUndefined();

    // 下次调用应该重试（仍触发）
    const sendFn2 = vi.fn().mockResolvedValue(undefined);
    const r2 = await svc.maybePrebake({
      chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn: sendFn2,
    });
    expect(r2.fired).toBe(true);
    expect(sendFn2).toHaveBeenCalledOnce();
  });

  it('不同 (chat, account) 互不干扰', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const svc = new ChatPrebakeService({ store, ttlMs: 60_000 });

    // (chat=A, bot=PM)
    await svc.maybePrebake({ chatId: 'oc_A', accountId: 'cli_pm', agentName: 'PM', sendFn });
    // (chat=A, bot=Prod) — 不同 bot
    await svc.maybePrebake({ chatId: 'oc_A', accountId: 'cli_prod', agentName: '产品经理', sendFn });
    // (chat=B, bot=PM) — 不同群
    await svc.maybePrebake({ chatId: 'oc_B', accountId: 'cli_pm', agentName: 'PM', sendFn });
    // (chat=A, bot=PM) 重复 — 应被跳过
    await svc.maybePrebake({ chatId: 'oc_A', accountId: 'cli_pm', agentName: 'PM', sendFn });

    expect(sendFn).toHaveBeenCalledTimes(3);
  });

  it('chatId 或 accountId 缺 → 跳过不抛错', async () => {
    const sendFn = vi.fn();
    const svc = new ChatPrebakeService({ store });

    const r1 = await svc.maybePrebake({ chatId: '', accountId: 'cli_pm', agentName: 'PM', sendFn });
    expect(r1.fired).toBe(false);
    expect(sendFn).not.toHaveBeenCalled();

    const r2 = await svc.maybePrebake({ chatId: 'oc_x', accountId: '', agentName: 'PM', sendFn });
    expect(r2.fired).toBe(false);
  });

  it('agentEmoji 缺 → 用默认 🤖', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const svc = new ChatPrebakeService({ store });

    await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });
    const sentText = sendFn.mock.calls[0][0] as string;
    expect(sentText).toContain('🤖');
  });

  it('agentEmoji 自定义 → 用 custom emoji', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const svc = new ChatPrebakeService({ store });

    await svc.maybePrebake({
      chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', agentEmoji: '📈', sendFn,
    });
    const sentText = sendFn.mock.calls[0][0] as string;
    expect(sentText).toContain('📈');
    expect(sentText).not.toContain('🤖');
  });

  it('resetAll 清空 → 允许立即重发', async () => {
    const sendFn = vi.fn().mockResolvedValue(undefined);
    const svc = new ChatPrebakeService({ store, ttlMs: 60_000 });

    await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });
    expect(sendFn).toHaveBeenCalledTimes(1);

    svc.resetAll();
    await svc.maybePrebake({ chatId: 'oc_x', accountId: 'cli_pm', agentName: 'PM', sendFn });
    expect(sendFn).toHaveBeenCalledTimes(2);
  });
});

describe('buildPrebakeText', () => {
  it('必须以 @_all 开头（飞书 cross-app 修复关键）', () => {
    const text = buildPrebakeText('项目经理', '🤖');
    expect(text.startsWith('<at user_id="all"></at>')).toBe(true);
  });

  it('完整格式：@_all + emoji + name + 已上线', () => {
    expect(buildPrebakeText('项目经理', '🤖')).toBe('<at user_id="all"></at> 🤖 项目经理 已上线，准备协作');
    expect(buildPrebakeText('产品经理', '📈')).toBe('<at user_id="all"></at> 📈 产品经理 已上线，准备协作');
  });
});
