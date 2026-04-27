/**
 * Chat Prebake Service —— 启动 / 入群时让每个 bot 主动在群里发一条"上线打招呼"
 *
 * 背景（M13 cross-app 修复 — 配合 chat-history-prober）：
 *   prober 通过 messages.list 拉历史学习 viewer 视角的 open_id，但**冷启动**场景
 *   下（用户预先建群 → 拉 5 个 bot → 启动 EvoClaw）历史里没有 sender_type='app' 的
 *   消息（bot 入群事件的 sender 是触发添加的真人，不是被加入的 bot），prober 拉
 *   不到任何 bot 信息。
 *
 *   解决方案：每个 bot connect 后 / 入群事件触发时，主动在群里发一条短消息（如
 *   "🤖 项目经理 已上线"），让其他 4 个 bot 的 ws 收到 sender_type='app' 事件 →
 *   各自 viewer 视角学到本 bot 的 open_id。5 个 bot 各发一次，每个 viewer 都能学
 *   到其他 4 个的 open_id，cross-app 矩阵一次性建好。
 *
 *   去重：每个 (chat, bot) 24h 内只发一次（DB 表 feishu_chat_prebakes 落盘）—
 *   防止 dev 期间频繁重启刷屏。
 */

import { createLogger } from '../../../infrastructure/logger.js';
import type { SqliteStore } from '../../../infrastructure/db/sqlite-store.js';

const log = createLogger('feishu/chat-prebake');

/** 默认 24h 防抖窗口 */
const DEFAULT_TTL_MS = 24 * 60 * 60_000;

export interface ChatPrebakeServiceDeps {
  store: SqliteStore;
  /** 防抖窗口，默认 24h（测试可缩短） */
  ttlMs?: number;
}

export interface MaybePrebakeArgs {
  chatId: string;
  /** bot 自己的 feishu accountId（cli_xxx） */
  accountId: string;
  /** bot 对应 EvoClaw Agent 名字（用于消息文案） */
  agentName: string;
  /** Agent emoji（用于消息文案，缺省 🤖） */
  agentEmoji?: string;
  /**
   * 真正发送消息的回调（解耦 channel-manager 依赖；测试可注入 mock）
   *
   * 抛错时本次 prebake 不写时间戳——下次还会再试。
   */
  sendFn: (text: string) => Promise<void>;
}

export interface MaybePrebakeResult {
  /** 是否真正发送了 prebake 消息 */
  fired: boolean;
  /** 跳过原因（仅 fired=false 时填） */
  skipReason?: 'within_ttl' | 'send_error';
  /** 错误信息（仅 skipReason='send_error' 时） */
  error?: string;
}

/**
 * Prebake 调度器
 *
 * 用法：
 *   const prebake = new ChatPrebakeService({ store });
 *   await prebake.maybePrebake({
 *     chatId, accountId, agentName, agentEmoji,
 *     sendFn: (text) => adapter.sendMessage(chatId, text, 'group'),
 *   });
 */
export class ChatPrebakeService {
  private store: SqliteStore;
  private ttlMs: number;

  constructor(deps: ChatPrebakeServiceDeps) {
    this.store = deps.store;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * 检查 (chatId, accountId) 是否需要 prebake；需要则发送，发送成功后写时间戳。
   *
   * 失败兜底：sendFn 抛错时不写时间戳，调用方下次再试。
   */
  async maybePrebake(args: MaybePrebakeArgs): Promise<MaybePrebakeResult> {
    const { chatId, accountId, agentName, agentEmoji = '🤖', sendFn } = args;
    if (!chatId || !accountId) return { fired: false, skipReason: 'within_ttl' };

    // 1. 查上次 prebake 时间
    const row = this.store.get<{ last_prebake_at: string }>(
      `SELECT last_prebake_at FROM feishu_chat_prebakes WHERE chat_id = ? AND account_id = ?`,
      chatId,
      accountId,
    );
    if (row) {
      // SQLite datetime('now') 返回 'YYYY-MM-DD HH:MM:SS'（无 Z），Date.parse 在 Node
      // 上按 local time 解析。这里手动拼成 ISO 8601 with Z（视为 UTC）—— 跟下面 INSERT
      // 用的 strftime('%Y-%m-%dT%H:%M:%fZ', 'now') 一致。
      const isoStr = row.last_prebake_at.includes('T')
        ? row.last_prebake_at  // 已是 ISO 格式（INSERT 写入或外部更新）
        : row.last_prebake_at.replace(' ', 'T') + 'Z';  // 兼容旧 datetime('now') 默认值
      const lastMs = Date.parse(isoStr);
      if (Number.isFinite(lastMs) && Date.now() - lastMs < this.ttlMs) {
        log.debug(
          `prebake skip (within TTL) chat=${chatId} account=${accountId} ` +
            `last=${row.last_prebake_at} ttl_h=${this.ttlMs / 3_600_000}`,
        );
        return { fired: false, skipReason: 'within_ttl' };
      }
    }

    // 2. 构造消息并发送
    const text = buildPrebakeText(agentName, agentEmoji);
    try {
      await sendFn(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`prebake send 失败 chat=${chatId} account=${accountId}: ${msg}`);
      return { fired: false, skipReason: 'send_error', error: msg };
    }

    // 3. 写时间戳（INSERT OR REPLACE）—— 用 ISO 8601 with Z，避免 Date.parse 时区误判
    try {
      const nowIso = new Date().toISOString();
      this.store.run(
        `INSERT INTO feishu_chat_prebakes (chat_id, account_id, last_prebake_at)
         VALUES (?, ?, ?)
         ON CONFLICT(chat_id, account_id) DO UPDATE SET last_prebake_at = excluded.last_prebake_at`,
        chatId,
        accountId,
        nowIso,
      );
    } catch (err) {
      // DB 写入失败不阻塞——已经成功发了消息，下次重启可能重复一次但成本可接受
      log.warn(
        `prebake DB 写入失败 chat=${chatId} account=${accountId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    log.info(`prebake fired chat=${chatId} account=${accountId} agent=${agentName}`);
    return { fired: true };
  }

  /** 测试 / 紧急回退：清空所有 prebake 记录 */
  resetAll(): void {
    this.store.run(`DELETE FROM feishu_chat_prebakes`);
  }
}

/**
 * 上线消息文案（与 buildPrebakeText 解耦便于改）
 *
 * 设计：
 *   - 简短一行（~15 字以内）—— 群里看着不突兀
 *   - 含 agentName —— 让看到的真人能认出"这是我刚加的 EvoClaw bot"
 *   - 不带任务 / 协作 / 派活字眼 —— 清晰是"系统就绪通知"，不是真协作消息
 */
export function buildPrebakeText(agentName: string, agentEmoji: string): string {
  return `${agentEmoji} ${agentName} 已上线，准备协作`;
}
