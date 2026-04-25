/**
 * FeishuPeerBotRegistry —— 飞书群内 EvoClaw 同事 bot 的被动缓存（M13 PR3）
 *
 * 背景：
 * 飞书 chat.members.get **不返回机器人成员**（SDK 文档明确说明）。所以无法通过
 * 群成员 API 主动列出群里的 bot；只能从入站事件中累积。
 *
 * 数据模型：
 *   chatId → Map<appId, { openId?, addedAt, lastSeenAt }>
 *
 * 数据来源（由 adapter index.ts 注入回调）：
 *   - im.chat.member.bot.added_v1：本机 bot 入群 → register(chatId, appId)
 *   - im.chat.member.bot.deleted_v1：本机 bot 出群 → unregister
 *   - 入站消息：sender_type=app + sender_id 已知 → 同时记录 appId + openId
 *   - bindings 表关闭时扫一遍：哪些 (channel='feishu', accountId=...) 之前进过哪些群
 *
 * 输出语义：
 *   listInChat(chatId): 返回该群里所有"已知"的本机 bot identity
 *   仅含 EvoClaw 本地 bindings 中存在的（陌生 bot 自动过滤）
 */

import { createLogger } from '../../../infrastructure/logger.js';
import type { BindingRouter } from '../../../routing/binding-router.js';

const logger = createLogger('feishu/peer-bot-registry');

/** 一条 bot 在群内的记录 */
export interface PeerBotEntry {
  appId: string;
  openId?: string;
  addedAt: number;
  lastSeenAt: number;
}

/** lookup 结果 */
export interface PeerBotLookup {
  agentId: string;
  appId: string;
  /** 该 bot 自己的 open_id（用于飞书 `<at user_id>` mention） */
  openId?: string;
}

export interface FeishuPeerBotRegistryDeps {
  bindingRouter: BindingRouter;
}

export class FeishuPeerBotRegistry {
  private byChatId = new Map<string, Map<string, PeerBotEntry>>();
  private bindingRouter: BindingRouter;

  constructor(deps: FeishuPeerBotRegistryDeps) {
    this.bindingRouter = deps.bindingRouter;
  }

  /**
   * 标记某个 (chatId, appId) bot 在群内
   *
   * @param openId 该 bot 自己的 open_id，可选，已知时建议传
   */
  registerBotInChat(chatId: string, appId: string, openId?: string): void {
    if (!chatId || !appId) return;
    let inChat = this.byChatId.get(chatId);
    if (!inChat) {
      inChat = new Map();
      this.byChatId.set(chatId, inChat);
    }
    const existing = inChat.get(appId);
    if (existing) {
      existing.lastSeenAt = Date.now();
      // 优先保留已有的 openId；如果之前没有现在有，补上
      if (openId && !existing.openId) {
        existing.openId = openId;
        logger.debug(`补齐 openId chat=${chatId} app=${appId} openId=${openId}`);
      }
    } else {
      inChat.set(appId, {
        appId,
        openId,
        addedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      logger.info(`注册 bot 入群 chat=${chatId} app=${appId} openId=${openId ?? '(unknown)'}`);
    }
  }

  /** 标记 bot 出群 */
  unregisterBotInChat(chatId: string, appId: string): void {
    const inChat = this.byChatId.get(chatId);
    if (!inChat) return;
    if (inChat.delete(appId)) {
      logger.info(`注销 bot 出群 chat=${chatId} app=${appId}`);
    }
    if (inChat.size === 0) {
      this.byChatId.delete(chatId);
    }
  }

  /** 移除整个群（群被解散时） */
  invalidateChat(chatId: string): void {
    if (this.byChatId.delete(chatId)) {
      logger.debug(`清空群 ${chatId} 的 bot 列表`);
    }
  }

  /**
   * N5 修复：清理超过 maxAgeMs（默认 30 天）未活跃的 entry
   *
   * 触发：建议接到 escalation tick 每 5 min 调一次（成本低，扫描整个 map），
   * 不依赖飞书 bot.deleted 事件可靠交付（事件丢失时仍能兜底回收）
   *
   * @returns 清理的 entry 数
   */
  gc(maxAgeMs = 30 * 24 * 60 * 60_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [chatId, inChat] of this.byChatId) {
      for (const [appId, entry] of inChat) {
        if (entry.lastSeenAt < cutoff) {
          inChat.delete(appId);
          removed++;
        }
      }
      if (inChat.size === 0) this.byChatId.delete(chatId);
    }
    if (removed > 0) {
      logger.info(`peer-bot-registry GC 清理 ${removed} 个超过 ${maxAgeMs / 86_400_000}d 未活跃 entry`);
    }
    return removed;
  }

  /**
   * 列出群里所有"已知 EvoClaw 同事"的 bot
   *
   * 解析步骤：
   *   1. 取 chatId 下所有已观察到的 appId（精确）
   *   2. **bootstrap 兜底（S3 修复）**：合并 bindings 表里所有 feishu agent 作为
   *      候选。注：候选不一定真在群里，但 LLM 看到 roster 后调 mention_peer 时
   *      若对方真不在群、消息会被对方 inbound classifyAppSender 当 stranger 丢，
   *      不会误送。代价是首次拆 plan 时 prompt 略大，换到 LLM 能拆出正确的 assignee
   *   3. 反查 bindings 表 (channel='feishu', accountId=appId)
   *   4. 找到对应的 EvoClaw agentId
   *   5. 过滤掉 selfAgentId
   *   6. 组装 PeerBotLookup[]
   */
  listInChat(chatId: string, selfAgentId: string): PeerBotLookup[] {
    const allBindings = this.bindingRouter.listBindings().filter((b) => b.channel === 'feishu');
    const accountToAgent = new Map<string, string>();
    /**
     * (M13 @ 死锁修复) appId → bot 自身 open_id 兜底表。
     * connect 时 adapter 拉 /open-apis/bot/v3/info → BindingRouter.setBotOpenId
     * 写入 binding.bot_open_id；这里用作 registry 还没观察到 entry 的兜底。
     */
    const accountToBotOpenId = new Map<string, string>();
    for (const b of allBindings) {
      if (b.accountId) {
        accountToAgent.set(b.accountId, b.agentId);
        if (b.botOpenId) accountToBotOpenId.set(b.accountId, b.botOpenId);
      }
    }

    const inChat = this.byChatId.get(chatId);
    const result: PeerBotLookup[] = [];
    const seenAgentIds = new Set<string>();

    // Step 1+2: 已观察到的 → 优先（含 openId 信息），缺失时用 binding 兜底
    if (inChat) {
      for (const entry of inChat.values()) {
        const agentId = accountToAgent.get(entry.appId);
        if (!agentId) continue;
        if (agentId === selfAgentId) continue;
        seenAgentIds.add(agentId);
        const fallbackOpenId = accountToBotOpenId.get(entry.appId);
        const finalOpenId = entry.openId ?? fallbackOpenId;
        if (!entry.openId && fallbackOpenId) {
          logger.debug(
            `listInChat 用 binding 兜底 chat=${chatId} app=${entry.appId} openId=${fallbackOpenId}`,
          );
        }
        result.push({
          agentId,
          appId: entry.appId,
          openId: finalOpenId,
        });
      }
    }

    // Step 3 (S3 bootstrap): 还没观察到的本地 binding agent 也加进 candidate
    // M13 修复：binding.bot_open_id 在 connect 时已回填，这里直接用作 mentionId，
    // 一举消除冷启动死锁（对方从未发过言但仍能被真·@）。
    for (const [appId, agentId] of accountToAgent) {
      if (agentId === selfAgentId) continue;
      if (seenAgentIds.has(agentId)) continue;
      const openId = accountToBotOpenId.get(appId);
      if (openId) {
        logger.debug(
          `listInChat 冷启动 binding 兜底 chat=${chatId} app=${appId} agent=${agentId} openId=${openId}`,
        );
      }
      result.push({ agentId, appId, openId });
    }

    return result;
  }

  /**
   * 反查：给定 sender appId + chatId，是否为已知 EvoClaw 同事？
   * 用于 inbound classifyInboundMessage 的 'peer' 判定。
   *
   * 副作用：识别成功时会更新 lastSeenAt（保鲜）
   */
  classifyPeer(chatId: string, senderAppId: string, senderOpenId?: string): { agentId: string; openId?: string } | null {
    if (!chatId || !senderAppId) return null;
    const allBindings = this.bindingRouter.listBindings().filter((b) => b.channel === 'feishu');
    const binding = allBindings.find((b) => b.accountId === senderAppId);
    if (!binding) return null;

    // 副作用：观察到本群的活跃同事 → 写进 registry，让后续 listInChat 能看到
    this.registerBotInChat(chatId, senderAppId, senderOpenId);
    return {
      agentId: binding.agentId,
      openId: senderOpenId ?? this.byChatId.get(chatId)?.get(senderAppId)?.openId,
    };
  }

  /** 测试 / 紧急回退用：清空所有数据 */
  reset(): void {
    this.byChatId.clear();
  }

  /** 调试用：当前所有快照 */
  snapshot(): Record<string, PeerBotEntry[]> {
    const out: Record<string, PeerBotEntry[]> = {};
    for (const [chatId, m] of this.byChatId) {
      out[chatId] = Array.from(m.values());
    }
    return out;
  }
}
