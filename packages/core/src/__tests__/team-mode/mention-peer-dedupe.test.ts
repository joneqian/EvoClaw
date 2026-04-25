/**
 * mention-peer 去重 tracker 单测（M13 修复 — 问题 1 双 @）
 *
 * 覆盖：
 *   - mark + isRecent 5 秒窗口
 *   - 三元组 (group, peer, task) 唯一性
 *   - 无 taskId 时不参与去重
 *   - GC 清理过期 entry
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mentionPeerNotificationTracker } from '../../agent/team-mode/mention-peer-tool.js';

describe('mentionPeerNotificationTracker', () => {
  beforeEach(() => {
    mentionPeerNotificationTracker.__resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mark 之后 5 秒内 isRecent 返回 true', () => {
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-prod', 'task-1')).toBe(true);
  });

  it('5 秒后 isRecent 返回 false', () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);

    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-prod', 'task-1')).toBe(true);

    // 推进 5001ms
    vi.setSystemTime(now + 5001);
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-prod', 'task-1')).toBe(false);
  });

  it('不同 group 互不影响', () => {
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_y', 'a-prod', 'task-1')).toBe(false);
  });

  it('不同 peer 互不影响', () => {
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-ui', 'task-1')).toBe(false);
  });

  it('不同 task 互不影响', () => {
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-prod', 'task-2')).toBe(false);
  });

  it('isRecent 无 taskId 始终返回 false（不参与去重）', () => {
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-prod', undefined)).toBe(false);
  });

  it('mark 同一 (group, peer, task) 多次 → 时间戳被刷新（窗口续期）', () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');

    vi.setSystemTime(now + 4000); // 4s 后又 mark 一次
    mentionPeerNotificationTracker.mark('feishu:chat:oc_x', 'a-prod', 'task-1');

    vi.setSystemTime(now + 5500); // 距首次 5.5s，但距第二次只 1.5s
    expect(mentionPeerNotificationTracker.isRecent('feishu:chat:oc_x', 'a-prod', 'task-1')).toBe(true);
  });
});
