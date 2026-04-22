/**
 * 飞书群聊旁听缓冲区（Pending History Buffer）
 *
 * 解决"多机器人群内协作"场景：
 * - 群里未 @ 机器人的消息，原本直接丢弃 → 改为写入本 buffer
 * - 任一 Agent 被 @ 唤醒时，把 buffer 最近 N 条作为"前情提要"注入当前消息前缀
 * - Agent 自己发送成功的回复也回写到 buffer，便于后续其他 Agent 被 @ 时看到
 *
 * 设计决策：
 * - buffer 在内存，不持久化、不跨进程，sidecar 重启清空（非关键数据）
 * - TTL 与 limit 淘汰均在 record/peek 时懒执行，不起定时器
 * - historyKey = chatId（+ topicId），**不跟随 group_sender**：多机器人协作
 *   要看到"群里发生了什么"，按发送者切会破坏协作语义
 *
 * 参考 OpenClaw `extensions/feishu/src/bot.ts:269-279,482-494,798-813`
 */

/** 单条旁听条目 */
export interface GroupHistoryEntry {
  /** 发送者 open_id（真人用户或机器人） */
  sender: string;
  /** 展示名（真人昵称 / bot 名），缺省时用 sender 兜底 */
  senderName?: string;
  /** 已格式化的纯文本正文，不含 markdown / post / 卡片结构 */
  body: string;
  /** 飞书服务端消息时间戳（ms）；机器人自发回复时用 Date.now() */
  timestamp: number;
  /** 飞书 message_id，用于去重（同一条事件重复下发时） */
  messageId: string;
  /** true 表示本 Agent / 其他 Agent 的回复；false 表示真人发言 */
  fromBot: boolean;
}

/** 旁听缓冲配置 */
export interface GroupHistoryConfig {
  /** 总开关，默认 true */
  enabled: boolean;
  /** 每个 historyKey 保留的最大条数，超过时 FIFO 淘汰 oldest */
  limit: number;
  /** 条目 TTL（分钟），record / peek 时懒淘汰过期条目 */
  ttlMinutes: number;
  /** 是否把 Agent 自己的回复回写到 buffer，默认 true */
  includeBotMessages: boolean;
}

/** 默认配置（与 config schema 保持一致） */
export const DEFAULT_GROUP_HISTORY_CONFIG: GroupHistoryConfig = {
  enabled: true,
  limit: 20,
  ttlMinutes: 30,
  includeBotMessages: true,
};

/**
 * 内存 rolling buffer，Map<historyKey, entries>
 *
 * 线程模型：飞书 SDK 事件回调单线程串行执行，record / peek 间不会并发；
 * outbound 回写可能跨 Promise 边界，但 Node.js 单线程 event loop 同样安全。
 */
export class GroupHistoryBuffer {
  private readonly store = new Map<string, GroupHistoryEntry[]>();
  /** 防重：跟踪最近 messageId，避免同一条事件被重复投递（Phase B broadcast 路径会重入） */
  private readonly seenMessageIds = new Map<string, Set<string>>();
  /** seenMessageIds 的大小上限（每个 historyKey），防无界增长 */
  private static readonly SEEN_IDS_CAP = 200;

  /**
   * 记录一条条目
   *
   * 语义：
   * - config.enabled=false → 空操作
   * - limit=0 → 空操作（等价禁用）
   * - 同 messageId 重复 → 空操作（去重）
   * - 懒淘汰：本次操作前先把过期 + 溢出条目丢弃
   */
  record(
    historyKey: string,
    entry: GroupHistoryEntry,
    config: GroupHistoryConfig,
  ): void {
    if (!config.enabled) return;
    if (config.limit <= 0) return;
    if (!historyKey) return;

    // 去重
    let seen = this.seenMessageIds.get(historyKey);
    if (!seen) {
      seen = new Set();
      this.seenMessageIds.set(historyKey, seen);
    }
    if (seen.has(entry.messageId)) return;
    seen.add(entry.messageId);
    // seen 集合上限控制（超出时清空，成本可接受）
    if (seen.size > GroupHistoryBuffer.SEEN_IDS_CAP) {
      seen.clear();
      seen.add(entry.messageId);
    }

    const arr = this.store.get(historyKey) ?? [];
    this.prune(arr, config);
    arr.push(entry);
    // 长度约束
    while (arr.length > config.limit) {
      arr.shift();
    }
    this.store.set(historyKey, arr);
  }

  /**
   * 读取最近 limit 条（按时间顺序，oldest 在前）
   *
   * 读时也执行懒淘汰，保证过期条目不会被注入。
   */
  peek(historyKey: string, config: GroupHistoryConfig): GroupHistoryEntry[] {
    if (!config.enabled) return [];
    if (!historyKey) return [];
    const arr = this.store.get(historyKey);
    if (!arr || arr.length === 0) return [];
    this.prune(arr, config);
    if (arr.length === 0) {
      this.store.delete(historyKey);
      return [];
    }
    return arr.slice(Math.max(0, arr.length - config.limit));
  }

  /** 清空某 key（测试用 / 连接断开时可选调用） */
  clear(historyKey?: string): void {
    if (historyKey === undefined) {
      this.store.clear();
      this.seenMessageIds.clear();
      return;
    }
    this.store.delete(historyKey);
    this.seenMessageIds.delete(historyKey);
  }

  /** 返回 buffer 中 key 的数量（用于测试 / 监控） */
  size(): number {
    return this.store.size;
  }

  /** 懒淘汰：去掉过期条目 + 溢出条目（就地 splice） */
  private prune(arr: GroupHistoryEntry[], config: GroupHistoryConfig): void {
    if (config.ttlMinutes > 0) {
      const cutoff = Date.now() - config.ttlMinutes * 60_000;
      while (arr.length > 0 && arr[0]!.timestamp < cutoff) {
        arr.shift();
      }
    }
    while (arr.length > config.limit) {
      arr.shift();
    }
  }
}

/** 构造 historyKey —— chatId（+ topicId） */
export function buildHistoryKey(params: {
  chatId: string;
  threadId?: string;
}): string {
  const { chatId, threadId } = params;
  if (!chatId) return '';
  return threadId ? `${chatId}:topic:${threadId}` : chatId;
}

/**
 * 把 buffer 内容格式化为"前情提要"，拼在当前消息前面
 *
 * 输出格式（简体中文，对非开发用户友好）：
 * ```
 * [群聊前情提要（最近 N 条，不含本条）]
 * - [HH:mm] 张三：消息内容
 * - [HH:mm] Agent-A（机器人）：回复内容
 *
 * [当前 @ 你的消息]
 * 李四: 帮我评估一下
 * ```
 *
 * 当 entries 为空时，直接返回 currentMessage（不加任何前缀）。
 */
export function formatGroupHistoryContext(params: {
  entries: readonly GroupHistoryEntry[];
  currentMessage: string;
}): string {
  const { entries, currentMessage } = params;
  if (entries.length === 0) return currentMessage;

  const lines = entries.map((e) => formatEntryLine(e));
  return [
    `[群聊前情提要（最近 ${entries.length} 条，不含本条）]`,
    ...lines,
    '',
    '[当前 @ 你的消息]',
    currentMessage,
  ].join('\n');
}

/** 单条渲染 —— "- [HH:mm] name（机器人?）：body" */
function formatEntryLine(entry: GroupHistoryEntry): string {
  const time = formatTime(entry.timestamp);
  const name = entry.senderName?.trim() || entry.sender || '匿名';
  const tag = entry.fromBot ? '（机器人）' : '';
  // body 可能多行，压缩换行避免破坏列表格式
  const body = entry.body.replace(/\s+/g, ' ').trim();
  return `- [${time}] ${name}${tag}：${body}`;
}

/** 把 ms 时间戳格式化为 HH:mm（本地时区，对飞书用户直观） */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
