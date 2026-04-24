/**
 * 入站消息处理
 *
 * 职责：
 * - 订阅 SDK 事件（im.message.receive_v1）
 * - 把 SDK 事件载荷桥接到 `normalizeFeishuMessage`
 * - 群聊过滤：未 @机器人 的消息直接忽略
 * - 忽略机器人自己发送的消息
 * - 媒体消息（image/file/audio/media）可选通过 downloader 下载到本地
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import type { QuotedMessage } from '@evoclaw/shared';
import type { MessageHandler } from '../../channel-adapter.js';
import { normalizeFeishuMessage } from '../../message-normalizer.js';
import { parseFeishuContent } from './parse-content.js';
import { createLogger } from '../../../infrastructure/logger.js';
import {
  buildFeishuGroupPeerId,
  type FeishuGroupSessionScope,
} from './session-key.js';
import {
  GroupHistoryBuffer,
  buildHistoryKey,
  formatGroupHistoryContext,
  type GroupHistoryConfig,
} from './group-history.js';
import {
  resolveBroadcastTargets,
  type BroadcastConfig,
} from './broadcast.js';
import type {
  FeishuMessageCache,
  FeishuMessageCacheEntry,
} from './message-cache.js';

const log = createLogger('feishu-inbound');

/**
 * 入站事件去重 —— 防止飞书服务端重推导致 **同一** Agent 重复处理
 *
 * 背景：飞书 WS 对同一条用户消息可能投递多次（不同 WS message_id 但同 app 层
 * message.message_id）。服务端触发重推的典型条件：
 * - SDK 的 `eventDispatcher.invoke` 返回过慢（> ~10s）→ 服务端认为客户端失效
 * - 网络抖动导致 ACK 丢失
 *
 * **重要**：key 必须包含 accountId（= appId），否则群里多 bot 协作时，飞书会把
 * 同一条群消息 fanout 给 N 个 app 的 WS（每个 app 各一份，message_id 相同），
 * 全局 key 会让除第一个到达的 adapter 外其他全部被误判成"重推"并 drop，
 * 导致 2..N 号 agent 的旁听缓冲永远空、@ 对方时看不到上下文。
 *
 * 本次真机实测（fire-and-forget 之前）：Agent 处理 9+ 秒 → 服务端 18 秒后重推，
 * 导致用户发一句"你好"收到两次回复。主修复是把 handler 改为 fire-and-forget 让
 * SDK 秒 ACK，这份 LRU 是兜底。
 *
 * 简单 Map + 时间戳 + 软容量上限即可（不追求 O(1) LRU 淘汰精确度，避免引入
 * 额外依赖；飞书 WS 单连接单进程，并发压力有限）。
 */
const SEEN_MESSAGE_IDS = new Map<string, number>();
const SEEN_TTL_MS = 10 * 60_000; // 10 分钟窗口
const SEEN_MAX_SIZE = 2000;

/** 复合 key：accountId + U+001F(Unit Separator) + messageId，跨 appId 互不干扰 */
function dedupeKey(accountId: string, messageId: string): string {
  return `${accountId}${messageId}`;
}

function markSeen(accountId: string, messageId: string): boolean {
  const now = Date.now();
  // 懒淘汰：触发容量或 TTL 时扫一遍
  if (SEEN_MESSAGE_IDS.size >= SEEN_MAX_SIZE) {
    const cutoff = now - SEEN_TTL_MS;
    for (const [id, ts] of SEEN_MESSAGE_IDS.entries()) {
      if (ts < cutoff) SEEN_MESSAGE_IDS.delete(id);
    }
    // 仍然超过上限时清掉最老一半
    if (SEEN_MESSAGE_IDS.size >= SEEN_MAX_SIZE) {
      const entries = Array.from(SEEN_MESSAGE_IDS.entries()).sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < entries.length / 2; i++) {
        SEEN_MESSAGE_IDS.delete(entries[i]![0]);
      }
    }
  }
  const key = dedupeKey(accountId, messageId);
  const prev = SEEN_MESSAGE_IDS.get(key);
  if (prev !== undefined && now - prev < SEEN_TTL_MS) {
    return true; // 已见过
  }
  SEEN_MESSAGE_IDS.set(key, now);
  return false;
}

/** 测试用：清空去重状态 */
export function __clearInboundDedupe(): void {
  SEEN_MESSAGE_IDS.clear();
}

/**
 * 检测纯文本中是否存在 `@_all` 裸 token
 *
 * 飞书真实行为：群聊 `@所有人` 时 `mentions` 为空数组，标记仅以 `@_all`
 * 字面 token 出现在文本里（text 消息为 `{"text":"@_all 大家好"}`）。
 * 测试 fixture 长期写的是 `mentions: [{key:'@_all'}]`，和真机不一致 —— 这
 * 是本函数兜底的动机。
 *
 * 边界要求：`@_all` 必须与前后留空白或串首/尾相接，避免误匹配
 * `user@_all.com` / `@_allcaps` 之类的假阳。
 */
export function containsAtAllToken(text: string | null | undefined): boolean {
  if (!text) return false;
  return /(^|\s)@_all(\s|$)/.test(text);
}

/** im.message.receive_v1 事件载荷（与 SDK 类型同构，取必要字段） */
export interface FeishuReceiveEvent {
  sender: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    thread_id?: string;
    root_id?: string;
    parent_id?: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
}

/** 媒体下载回调签名 */
export type MediaDownloader = (params: {
  messageId: string;
  fileKey: string;
  msgType: string;
  fileName?: string;
}) => Promise<{ path: string; mimeType: string | null } | null>;

/**
 * 按 messageId 回查被引用消息的签名（LRU miss 后的兜底）
 *
 * 返回 null 表示查询失败，inbound 会降级为 `[引用消息]` 占位，不阻塞主流程。
 */
export type FeishuMessageFetcher = (
  messageId: string,
) => Promise<FeishuMessageCacheEntry | null>;

/** 入站处理所需的上下文（用函数而非快照，支持运行时变化） */
export interface InboundContext {
  getAccountId: () => string;
  getBotOpenId: () => string | null;
  getHandler: () => MessageHandler | null;
  getMediaDownloader?: () => MediaDownloader | null;
  /** 群会话隔离策略（默认 'group'） */
  getGroupSessionScope?: () => FeishuGroupSessionScope;
  /** 群聊旁听缓冲实例（多机器人协作） */
  getGroupHistory?: () => GroupHistoryBuffer | null;
  /** 群聊旁听缓冲配置，null 或 disabled 时跳过 */
  getGroupHistoryConfig?: () => GroupHistoryConfig | null;
  /** 广播配置（Phase B），null 或 disabled 时走单路路由 */
  getBroadcastConfig?: () => BroadcastConfig | null;
  /** 该群内已知机器人 open_id → agentId 映射（mention-first / any-mention 判定用） */
  getBotIdToAgentId?: () => Record<string, string>;
  /**
   * 入站消息缓存（供引用消息 O(1) 命中），每条入站消息都会写入供后续回查
   *
   * 未提供时退化为"不缓存 + 必走 fetcher（也不提供时降级为占位）"
   */
  getMessageCache?: () => FeishuMessageCache | null;
  /** LRU miss 时的 API 回查，缺省或失败时降级为 `[引用消息]` 占位 */
  getMessageFetcher?: () => FeishuMessageFetcher | null;
}

/**
 * 把 EventDispatcher 的 im.message.receive_v1 回调接入到 handler
 *
 * Fire-and-forget：dispatcher 回调不 await handleReceiveMessage。SDK 一进来就能
 * ACK 事件给飞书服务端，避免服务端在 10s 未 ACK 后重推（相同 messageId，会被
 * 我们的 dedupe 过滤成"忽略重复推送"，用户表现为消息丢失）。
 *
 * handleReceiveMessage 内部的所有 await（parent_id 回查、媒体下载、Agent 管线）
 * 都在这条 fire-and-forget 链里执行，跑多久都不阻塞 SDK。
 */
export function registerInboundHandlers(
  dispatcher: Lark.EventDispatcher,
  ctx: InboundContext,
): Lark.EventDispatcher {
  dispatcher.register({
    'im.message.receive_v1': async (data: FeishuReceiveEvent) => {
      // 诊断日志（临时）：确认事件有派发进来 + 记录 msg_type / 是否带 parent_id
      // 配合 WS 层的 `[feishu-ws] receive message, data: undefined` 一起看，
      // 如果有 WS 日志但没这行，说明 SDK dispatcher 没派发到本回调
      // 带 appId 前缀，方便群里多 bot 时区分是哪个 adapter 的日志
      log.info(
        `[${ctx.getAccountId()}] 事件派发 messageId=${data.message?.message_id} msg_type=${data.message?.message_type} parent_id=${data.message?.parent_id ?? '-'} chat_type=${data.message?.chat_type}`,
      );
      handleReceiveMessage(data, ctx).catch((err) => {
        log.error(
          `[${ctx.getAccountId()}] 入站处理失败 messageId=${data.message?.message_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
  });
  return dispatcher;
}

/**
 * 处理单条入站消息
 *
 * 导出用于测试 / Phase H 扩展复用
 */
export async function handleReceiveMessage(
  data: FeishuReceiveEvent,
  ctx: InboundContext,
): Promise<void> {
  const handler = ctx.getHandler();
  if (!handler) return;

  // 忽略机器人自己的消息
  if (data.sender.sender_type === 'app') return;

  const accountId = ctx.getAccountId();
  const message = data.message;

  // 去重（见文件顶部 SEEN_MESSAGE_IDS 说明）：飞书服务端可能向**同一 app** 重推
  // 相同 messageId。多 app fanout 因 key 带 accountId 互不干扰。
  if (markSeen(accountId, message.message_id)) {
    log.warn(`[${accountId}] 忽略重复推送 messageId=${message.message_id}`);
    return;
  }
  const senderOpenId = data.sender.sender_id?.open_id ?? '';
  const senderName = data.sender.sender_id?.user_id;
  const isGroup = message.chat_type === 'group';

  // 预解析正文供 buffer / downloader 复用
  const parsed = parseFeishuContent(message.message_type, message.content);

  // 群聊过滤：必须 @机器人 或 @所有人
  if (isGroup) {
    const mentions = message.mentions ?? [];
    const botOpenId = ctx.getBotOpenId();
    // @_all 真机 payload 的 mentions 为空，标记藏在 parsed.text 里；测试 fixture
    // 把 key 写在 mentions 是历史残留，两路都覆盖以防后续 Feishu 改回去。
    const atAllInText = containsAtAllToken(parsed.text);
    const mentioned =
      atAllInText ||
      mentions.some((m) => {
        if (m.key === '@_all') return true;
        if (botOpenId === null) return false;
        // 鲁棒性：同时匹配 open_id / user_id / union_id 的任一（飞书通常只填 open_id）
        return (
          m.id.open_id === botOpenId ||
          m.id.user_id === botOpenId ||
          m.id.union_id === botOpenId
        );
      });
    if (!mentioned) {
      // 未 @ 的群消息进入旁听缓冲（Phase A），不触发 agent
      recordToGroupHistory(ctx, message, {
        sender: senderOpenId,
        senderName: resolveSenderName(message.mentions, senderOpenId) ?? senderName,
        body: parsed.text,
        fromBot: false,
      });
      // 排障点：真机测试文档 T4.1 期望在此能看到"drop"类日志。DEBUG 级足够，
      // 默认 log level 过滤掉，避免扰乱正常运行。
      log.debug(
        `[${accountId}] 群消息未@本机器人，已入旁听缓冲 chat=${message.chat_id} msg=${message.message_id}`,
      );
      return;
    }
  }

  const normalized = normalizeFeishuMessage(
    {
      message_id: message.message_id,
      chat_type: message.chat_type,
      chat_id: message.chat_id,
      sender: {
        sender_id: { open_id: senderOpenId },
        sender_type: data.sender.sender_type,
      },
      content: message.content,
      msg_type: message.message_type,
    },
    ctx.getAccountId(),
  );

  // 把当前消息写入缓存，供后续"引用该消息"时回查
  const cache = ctx.getMessageCache?.() ?? null;
  if (cache) {
    cache.put({
      messageId: message.message_id,
      senderId: senderOpenId,
      ...(resolveSenderName(message.mentions, senderOpenId) ?? senderName
        ? { senderName: resolveSenderName(message.mentions, senderOpenId) ?? senderName }
        : {}),
      content: parsed.text,
      timestamp: normalized.timestamp,
    });
  }

  // 解析引用消息（parent_id 存在时）：LRU 优先 → API 兜底 → 占位降级
  //
  // fetcher 内置 2s 超时，不阻塞 SDK ACK（registerInboundHandlers 已把本函数
  // 整体放到 fire-and-forget，即使超时 Agent 也顶多晚 2 秒看到引用信息）。
  if (message.parent_id) {
    normalized.quoted = await resolveQuotedMessage(ctx, message.parent_id);
  }

  // 群聊：按 session scope 重写 peerId
  if (normalized.chatType === 'group') {
    const scope = ctx.getGroupSessionScope?.() ?? 'group';
    normalized.peerId = buildFeishuGroupPeerId({
      scope,
      chatId: message.chat_id,
      ...(senderOpenId ? { senderOpenId } : {}),
      ...(message.thread_id ? { threadId: message.thread_id } : {}),
    });
  }

  // 媒体下载（如果有 key + downloader）
  if (parsed.mediaKey) {
    const downloader = ctx.getMediaDownloader?.() ?? null;
    log.info(
      `[${accountId}] 媒体消息进入下载流程 messageId=${message.message_id} msg_type=${message.message_type} mediaKey=${parsed.mediaKey.slice(0, 20)}... downloader=${downloader ? '就绪' : '缺失'}`,
    );
    if (downloader) {
      try {
        const downloaded = await downloader({
          messageId: message.message_id,
          fileKey: parsed.mediaKey,
          msgType: message.message_type,
          ...(parsed.fileName !== undefined ? { fileName: parsed.fileName } : {}),
        });
        if (downloaded) {
          normalized.mediaPath = downloaded.path;
          if (downloaded.mimeType) normalized.mediaType = downloaded.mimeType;
          log.info(
            `[${accountId}] 媒体下载成功 messageId=${message.message_id} path=${downloaded.path} mime=${downloaded.mimeType ?? '-'}`,
          );
        } else {
          log.warn(`[${accountId}] 媒体下载返回 null messageId=${message.message_id}`);
        }
      } catch (err) {
        // 下载失败不阻塞消息流，但日志要打出来（否则 mediaPath 静默丢失无法排查）
        log.warn(
          `[${accountId}] 媒体下载失败 messageId=${message.message_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 群聊被 @ 时，前缀注入旁听缓冲作为前情提要（Phase A）
  if (isGroup) {
    const historyEntries = peekGroupHistory(ctx, message);
    if (historyEntries.length > 0) {
      normalized.content = formatGroupHistoryContext({
        entries: historyEntries,
        currentMessage: normalized.content,
      });
    }
    // 当前被 @ 的消息本身也写入 buffer，便于后续其他 Agent 被 @ 时看到
    recordToGroupHistory(ctx, message, {
      sender: senderOpenId,
      senderName: resolveSenderName(message.mentions, senderOpenId) ?? senderName,
      body: parsed.text,
      fromBot: false,
    });

    // Phase B: 群聊广播 fanout —— 命中时把目标 agent 列表挂到 normalized.broadcastTargets
    // 由 server.ts 路由层循环派发，绕过 BindingRouter
    const broadcastTargets = resolveBroadcastFanout(ctx, message, parsed.text);
    if (broadcastTargets && broadcastTargets.length > 0) {
      normalized.broadcastTargets = broadcastTargets;
    }
  }

  // handler 会触发 Agent 处理管线（可能耗时 10+ 秒）。SDK ACK 已由
  // registerInboundHandlers 层的 fire-and-forget 保障，这里直接 await 即可。
  //
  // Promise.resolve() 包装：handler 可能是非 async 的 mock（测试场景返回
  // undefined），直接 `.catch` 会 NPE；先 resolve 统一包成 Promise。
  await Promise.resolve(handler(normalized)).catch((err) => {
    log.error(
      `[${accountId}] agent 处理失败 messageId=${message.message_id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

/**
 * 基于 BroadcastConfig 决定是否把该条群消息 fanout 到多个 agent。
 *
 * 注意：peerId 在群聊下可能被 scope 重写（如 `oc_x:sender:ou_u`），但
 * broadcast 配置用户写的是原始 chat_id，所以这里直接用 `message.chat_id`。
 */
function resolveBroadcastFanout(
  ctx: InboundContext,
  message: FeishuReceiveEvent['message'],
  parsedText: string,
): string[] | null {
  const config = ctx.getBroadcastConfig?.() ?? null;
  if (!config || !config.enabled) return null;
  const mentions = message.mentions ?? [];
  // 同步修 @_all：真机 mentions 为空 + 裸 token 在文本里，见 containsAtAllToken 注释
  const mentionedAll =
    containsAtAllToken(parsedText) || mentions.some((m) => m.key === '@_all');
  return resolveBroadcastTargets({
    config,
    peerId: message.chat_id,
    botIdToAgentId: ctx.getBotIdToAgentId?.() ?? {},
    mentions,
    mentionedAll,
  });
}

/** 把一条消息记入旁听缓冲（enabled=false / buffer 缺失时安静跳过） */
function recordToGroupHistory(
  ctx: InboundContext,
  message: FeishuReceiveEvent['message'],
  entry: {
    sender: string;
    senderName: string | undefined;
    body: string;
    fromBot: boolean;
  },
): void {
  const buffer = ctx.getGroupHistory?.() ?? null;
  const config = ctx.getGroupHistoryConfig?.() ?? null;
  if (!buffer || !config || !config.enabled) return;
  const historyKey = buildHistoryKey({
    chatId: message.chat_id,
    ...(message.thread_id ? { threadId: message.thread_id } : {}),
  });
  if (!historyKey) return;
  buffer.record(
    historyKey,
    {
      sender: entry.sender,
      ...(entry.senderName ? { senderName: entry.senderName } : {}),
      body: entry.body,
      timestamp: Date.now(),
      messageId: message.message_id,
      fromBot: entry.fromBot,
    },
    config,
  );
}

/** 读取旁听缓冲（enabled=false / 无配置 / 无条目时返回空数组） */
function peekGroupHistory(
  ctx: InboundContext,
  message: FeishuReceiveEvent['message'],
): ReturnType<GroupHistoryBuffer['peek']> {
  const buffer = ctx.getGroupHistory?.() ?? null;
  const config = ctx.getGroupHistoryConfig?.() ?? null;
  if (!buffer || !config || !config.enabled) return [];
  const historyKey = buildHistoryKey({
    chatId: message.chat_id,
    ...(message.thread_id ? { threadId: message.thread_id } : {}),
  });
  if (!historyKey) return [];
  return buffer.peek(historyKey, config);
}

/**
 * 按 parentId 解析被引用消息 —— LRU 命中优先，miss 走 fetcher，失败降级占位
 *
 * 永远返回一个 QuotedMessage（不返回 null/undefined）：哪怕完全查不到，也保留
 * messageId 这条线索，Agent 至少知道"有一条引用"。
 *
 * 诊断要点：fetcher 调用不设硬超时，让飞书 SDK / 网络层的真实错误原样抛上来
 * （业务 code/msg、HTTP 状态等）。registerInboundHandlers 已把整个流程放到
 * fire-and-forget，即便 fetcher 慢也不会阻塞 SDK ACK。
 */
async function resolveQuotedMessage(
  ctx: InboundContext,
  parentId: string,
): Promise<QuotedMessage> {
  const cache = ctx.getMessageCache?.() ?? null;
  const hit = cache?.get(parentId) ?? null;
  if (hit) {
    return entryToQuoted(hit);
  }

  const fetcher = ctx.getMessageFetcher?.() ?? null;
  if (fetcher) {
    const accountId = ctx.getAccountId();
    try {
      const fetched = await fetcher(parentId);
      if (fetched) {
        // 回填缓存，避免连续引用同一条消息反复调 API
        cache?.put(fetched);
        return entryToQuoted(fetched);
      }
      log.warn(`[${accountId}] 引用消息回查返回 null parentId=${parentId}（权限不足 / 消息不存在 / 机器人不在会话中）`);
    } catch (err) {
      log.warn(
        `[${accountId}] 引用消息回查失败 parentId=${parentId}: ${describeFetchError(err)}`,
      );
    }
  }

  return {
    messageId: parentId,
    senderId: '',
    content: '[引用消息]',
  };
}

/**
 * 把飞书 SDK / fetch 抛出的错误展开成可诊断的字符串
 *
 * SDK 错误对象通常带：code / msg / response.status / response.data，直接打
 * `err.message` 只会看到外层封装（比如 "socket closed"），看不到飞书真实返回的
 * 业务 code。把能拿到的字段都 stringify 出来，才能判断是权限 / 参数 / 网络问题。
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  const e = err as unknown as Record<string, unknown>;
  if (typeof e.code === 'number' || typeof e.code === 'string') {
    parts.push(`code=${e.code}`);
  }
  if (typeof e.msg === 'string') parts.push(`msg=${e.msg}`);
  const response = e.response as Record<string, unknown> | undefined;
  if (response) {
    if (typeof response.status === 'number') parts.push(`http=${response.status}`);
    if (response.data !== undefined) {
      try {
        parts.push(`data=${JSON.stringify(response.data).slice(0, 500)}`);
      } catch {
        // 忽略循环引用
      }
    }
  }
  return parts.join(' | ');
}

function entryToQuoted(entry: FeishuMessageCacheEntry): QuotedMessage {
  const quoted: QuotedMessage = {
    messageId: entry.messageId,
    senderId: entry.senderId,
    content: entry.content,
    timestamp: entry.timestamp,
  };
  if (entry.senderName) quoted.senderName = entry.senderName;
  return quoted;
}

/** 从 mentions 里找到发送者的展示名（飞书 mention 有 name 字段，sender 自己没有） */
function resolveSenderName(
  mentions: FeishuReceiveEvent['message']['mentions'],
  senderOpenId: string,
): string | undefined {
  if (!mentions || !senderOpenId) return undefined;
  const hit = mentions.find(
    (m) =>
      m.id.open_id === senderOpenId ||
      m.id.user_id === senderOpenId ||
      m.id.union_id === senderOpenId,
  );
  return hit?.name;
}
