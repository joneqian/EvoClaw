/**
 * Sent Message Registry —— 跨 sidecar 共享发送过的 messageId 映射（M13 cross-app 修复）
 *
 * 背景：飞书 ws 事件里 bot-to-bot 消息的 sender 结构有 3 个坑：
 *   1. sender_type='bot'（不是 'app'）—— 我们代码原本只看 'app' 永远进不去 classify
 *   2. sender_id.app_id 字段不存在 —— 没法反查 binding 找 EvoClaw agent
 *   3. sender_id.union_id 在同一开发者租户下共享 —— 不区分 bot
 *
 * 唯一稳定信号是 message.message_id：发送方 sidecar 知道自己刚发的 messageId。
 * 5 个 bot 的 sidecar 跑在同一进程 → 共享一个内存 Map：
 *   messageId → { senderAgentId, senderAccountId, sentAt }
 *
 * 接收方 sidecar 在 inbound 处理时用 message_id 反查 → 知道是哪个 EvoClaw agent
 * 发的 → 配合事件里 viewer 视角的 sender_id.open_id → 写入 peer-bot-registry。
 *
 * 5 分钟 TTL（足够覆盖 ws fan-out 延迟，超过就视为过期）；条目超 1000 时简单 GC。
 */

import { createLogger } from '../../../infrastructure/logger.js';

const log = createLogger('feishu/sent-message-registry');

const TTL_MS = 5 * 60_000;  // 5 分钟
const MAX_ENTRIES = 1000;

interface SentMessageEntry {
  senderAgentId: string;
  senderAccountId: string;
  sentAt: number;
}

const sentMessages = new Map<string, SentMessageEntry>();

/**
 * 注册发送方 → messageId 映射（发送成功后立即调用）
 *
 * @param messageId 飞书返回的 om_xxx
 * @param senderAgentId 发送方 EvoClaw Agent ID
 * @param senderAccountId 发送方飞书 App ID（cli_xxx）
 */
export function recordSentMessage(
  messageId: string | undefined,
  senderAgentId: string,
  senderAccountId: string,
): void {
  if (!messageId || !senderAgentId || !senderAccountId) return;
  sentMessages.set(messageId, {
    senderAgentId,
    senderAccountId,
    sentAt: Date.now(),
  });
  log.debug(
    `record messageId=${messageId} sender_agent=${senderAgentId} sender_account=${senderAccountId} (size=${sentMessages.size})`,
  );

  // 容量超限时简单 GC：删过期 entry
  if (sentMessages.size > MAX_ENTRIES) {
    gc();
  }
}

/**
 * 反查 messageId → 发送方信息
 *
 * @returns 已注册且未过期返回 entry，否则返回 undefined
 */
export function lookupSentMessage(
  messageId: string | undefined,
): SentMessageEntry | undefined {
  if (!messageId) return undefined;
  const entry = sentMessages.get(messageId);
  if (!entry) return undefined;
  if (Date.now() - entry.sentAt > TTL_MS) {
    sentMessages.delete(messageId);
    return undefined;
  }
  return entry;
}

/** GC：清掉过期 entry */
function gc(): void {
  const cutoff = Date.now() - TTL_MS;
  let removed = 0;
  for (const [k, v] of sentMessages) {
    if (v.sentAt < cutoff) {
      sentMessages.delete(k);
      removed++;
    }
  }
  if (removed > 0) {
    log.debug(`gc 清理 ${removed} 条过期 entry，剩余 ${sentMessages.size}`);
  }
}

/** 测试 / 紧急回退用 */
export function resetSentMessageRegistry(): void {
  sentMessages.clear();
}

/** 测试用：peek 当前 size */
export function getSentMessageCount(): number {
  return sentMessages.size;
}
