/**
 * Feishu Topic Thread Anchor Registry
 *
 * 飞书 topic chat 的回复必须用 `im.v1.message.reply` API + `reply_in_thread: true`
 * 才能落到话题线程内（普通 `message.create` 即使带 receive_id_type='thread_id'
 * 也不被 API 接受）。reply API 需要 parent_message_id —— 即话题里**任意一条消息**
 * 的 message_id 作锚点。
 *
 * 本注册表把 (chatId, threadId) 映射到该话题最近一条已知消息的 message_id：
 * - inbound 解析层每次收到含 thread_id 的消息都更新锚点
 * - outbound 路由层在 group_topic / group_topic_sender 模式下查锚点构造 reply 调用
 * - 锚点缺失时降级为 chat_id create（消息会掉出话题，但比抛错好），并 log.warn
 *
 * 容量：1000 条 LRU（超过即按插入顺序淘汰最早项），单 sidecar 单进程足够
 * 覆盖正常多群多话题场景，不引入数据库依赖。
 */

import { createLogger } from '../../../../infrastructure/logger.js';

const log = createLogger('feishu-thread-anchor');

/** LRU 上限（避免长跑 sidecar 缓慢膨胀） */
const MAX_ANCHORS = 1000;

/**
 * 锚点表：key = `<chatId>:<threadId>`，value = 最近一条消息的 message_id。
 *
 * 用 Map 内置插入顺序作 LRU：set 时如果已存在先 delete 再 set，
 * 让"最近触达"的 key 总是落到 entries 末尾。淘汰从 head 取最早的 key。
 */
const anchors = new Map<string, string>();

function makeKey(chatId: string, threadId: string): string {
  return `${chatId}:${threadId}`;
}

/**
 * 记录或刷新某 (chatId, threadId) 的最近 message_id 锚点。
 *
 * 入参 messageId 为空字符串或 falsy 时静默跳过（防止意外清空有效锚点）。
 */
export function recordThreadAnchor(
  chatId: string,
  threadId: string,
  messageId: string,
): void {
  if (!chatId || !threadId || !messageId) return;

  const key = makeKey(chatId, threadId);

  // 已存在：先 delete 再 set，让 key 落到末尾（LRU "最近使用"语义）
  if (anchors.has(key)) {
    anchors.delete(key);
    anchors.set(key, messageId);
    return;
  }

  // 新增：超容量时淘汰最早一项
  if (anchors.size >= MAX_ANCHORS) {
    const oldest = anchors.keys().next().value;
    if (oldest) anchors.delete(oldest);
  }
  anchors.set(key, messageId);
  log.debug(
    `[anchor] recorded chatId=${chatId} threadId=${threadId} messageId=${messageId} size=${anchors.size}`,
  );
}

/**
 * 查 (chatId, threadId) 的锚点 messageId。返回 null 表示未注册（outbound 应降级）。
 *
 * 命中时同样把 key 重排到末尾（LRU "最近访问"语义），让活跃话题不被淘汰。
 */
export function getThreadAnchor(chatId: string, threadId: string): string | null {
  if (!chatId || !threadId) return null;
  const key = makeKey(chatId, threadId);
  const value = anchors.get(key);
  if (!value) return null;

  // LRU 重排
  anchors.delete(key);
  anchors.set(key, value);

  return value;
}

/** 测试 / 调试用：清空全部锚点 */
export function clearThreadAnchors(): void {
  anchors.clear();
}

/** 测试 / 调试用：当前锚点条数 */
export function getThreadAnchorSize(): number {
  return anchors.size;
}
