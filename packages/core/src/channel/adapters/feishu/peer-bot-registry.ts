/**
 * FeishuPeerBotRegistry —— 飞书群内 EvoClaw 同事 bot 的被动缓存
 *
 * 背景（M13 cross-app 修复）：
 *   飞书 open_id 是 **app-scoped**——同一个机器人/用户在不同 App 里 open_id 不一样。
 *   因此 registry 必须按 **viewer 维度** 维护：每个本机 App 各存一份"我看其他机器人
 *   的 open_id"。如果 5 个 App 共享一份 (chatId, appId) → openId 表，会被互相覆盖，
 *   下游用错就报 99992361 open_id cross app。
 *
 *   union_id 是租户级稳定 ID（飞书租户内多 App 共享），用作机器人**身份主键**——
 *   "同一个机器人在 5 个 App 视角下" 通过 union_id 识别为同一行。
 *
 * 数据模型（三维 Map）：
 *   chatId → viewerAppId → targetUnionId → entry
 *           （谁在看）   （看的是谁）  （viewer 视角的 open_id）
 *
 * 为什么仍保留 targetAppId（不是只用 union_id）：
 *   - 入群事件（bot.added / bot.deleted / p2p_entered）回调里**只能拿到 appId**
 *     （事件来源是飞书 App 管理面板，不带 union_id），需要这条 appId 的占位入口
 *     与后续入站消息（带 union_id）合并升级
 *   - audit / log 里 appId 比 union_id 更直观
 *
 * 数据来源（由 adapter index.ts 注入回调）：
 *   - im.message.receive_v1 (sender_type=app)：viewerApp 学到 (targetUnionId, openId)
 *   - im.chat.member.bot.added_v1：viewerApp 占位记录"target appId 在群里"，等首次
 *     消息升级 union_id + openId
 *   - bindings 表关闭时：哪些 (channel='feishu', accountId=...) 之前进过哪些群
 *
 * 输出语义：
 *   listInChat(chatId, viewerAccountId): 返回该群 + 该 viewer 视角下所有"已知"
 *     EvoClaw 同事的 (agentId, openId, unionId)。openId 缺失（冷启动期）时返回
 *     undefined，调用方应降级为纯文本 @<name>，避免跨 app 报错。
 */

import { createLogger } from '../../../infrastructure/logger.js';
import type { BindingRouter } from '../../../routing/binding-router.js';

const logger = createLogger('feishu/peer-bot-registry');

/**
 * 一条 (viewer, target) 对应的 entry。
 *
 * 同一个 target bot 在不同 viewer App 视角下有不同的 open_id，所以这条 entry
 * 嵌套在 byChatId[chat][viewerAppId][targetUnionId] 下面。
 */
export interface PeerBotEntry {
  /** target 机器人所属 App ID（cli_xxx） */
  targetAppId: string;
  /** target 机器人在租户内稳定 ID（跨 App 一致），机器人身份主键 */
  targetUnionId: string;
  /** target 机器人在 **viewer 视角** 下的 open_id（飞书 `<at>` 标签必须用这个）*/
  openId?: string;
  /** 首次注册时间 */
  addedAt: number;
  /** 上次见到（活跃保鲜） */
  lastSeenAt: number;
}

/** lookup 结果（per viewer 视角） */
export interface PeerBotLookup {
  agentId: string;
  /** target 机器人所属 App ID */
  appId: string;
  /** target 机器人 union_id（**跨 viewer 一致**，业务层做去重 / 跨渠道映射用）*/
  unionId?: string;
  /**
   * target 机器人在 viewer 视角下的 open_id。
   *
   * **注意**：冷启动期 viewer 还没观察到 target 发言时为 undefined。调用方应：
   *   - mention_peer / `<at>` 标签场景：降级为纯文本 @<name>，不带 `<at>` 标签
   *   - 不能用 `binding.bot_open_id` 兜底——那是 target 自己 App 视角的 open_id，
   *     在其他 App 用必定跨 app 报错
   */
  openId?: string;
}

export interface FeishuPeerBotRegistryDeps {
  bindingRouter: BindingRouter;
}

export class FeishuPeerBotRegistry {
  /** chatId → viewerAppId → targetUnionId → entry */
  private byChatId = new Map<string, Map<string, Map<string, PeerBotEntry>>>();

  /**
   * (chatId, viewerAppId) → 已观察过的 target appId 集合（即使还没拿到 union_id）
   * 用途：bot 入群事件 / 兜底兼容，仅有 appId 时占位记录。后续入站消息升级。
   */
  private chatViewerSeenAppIds = new Map<string, Map<string, Set<string>>>();

  private bindingRouter: BindingRouter;

  constructor(deps: FeishuPeerBotRegistryDeps) {
    this.bindingRouter = deps.bindingRouter;
  }

  /**
   * 标记某个 target bot 在群内（viewer 视角）。
   *
   * 调用场景：
   *   - 入站消息 sender_type=app：viewer 学到 (targetUnionId, openId)
   *   - 入群事件 bot.added：仅有 targetAppId 占位，union_id / openId 后续升级
   *
   * @param chatId 群 ID
   * @param viewerAppId 收到事件的本机 App ID（"谁在看"）
   * @param targetAppId target 机器人所属 App ID
   * @param targetUnionId target 机器人 union_id（占位时可空，后续升级）
   * @param openId target 机器人在 viewer 视角下的 open_id（占位时可空）
   */
  registerBotInChat(args: {
    chatId: string;
    viewerAppId: string;
    targetAppId: string;
    targetUnionId?: string;
    openId?: string;
  }): void {
    const { chatId, viewerAppId, targetAppId, targetUnionId, openId } = args;
    if (!chatId || !viewerAppId || !targetAppId) return;

    // 占位 set：记录该 viewer 在该群见过 targetAppId（即使没 union_id）
    let viewerMap = this.chatViewerSeenAppIds.get(chatId);
    if (!viewerMap) {
      viewerMap = new Map();
      this.chatViewerSeenAppIds.set(chatId, viewerMap);
    }
    let appIdSet = viewerMap.get(viewerAppId);
    if (!appIdSet) {
      appIdSet = new Set();
      viewerMap.set(viewerAppId, appIdSet);
    }
    appIdSet.add(targetAppId);

    // 没 union_id → 只占位，等后续入站消息升级
    if (!targetUnionId) {
      logger.debug(
        `占位（无 union_id） chat=${chatId} viewer=${viewerAppId} target_app=${targetAppId}`,
      );
      return;
    }

    // 三维 Map 写入
    let chatLevel = this.byChatId.get(chatId);
    if (!chatLevel) {
      chatLevel = new Map();
      this.byChatId.set(chatId, chatLevel);
    }
    let viewerLevel = chatLevel.get(viewerAppId);
    if (!viewerLevel) {
      viewerLevel = new Map();
      chatLevel.set(viewerAppId, viewerLevel);
    }
    const existing = viewerLevel.get(targetUnionId);
    if (existing) {
      existing.lastSeenAt = Date.now();
      // 升级缺失字段（占位 → 完整）
      if (openId && !existing.openId) {
        existing.openId = openId;
        logger.debug(
          `升级 openId chat=${chatId} viewer=${viewerAppId} target=${targetUnionId} openId=${openId}`,
        );
      }
      if (targetAppId && existing.targetAppId !== targetAppId) {
        existing.targetAppId = targetAppId;  // 极少见但保险
      }
    } else {
      viewerLevel.set(targetUnionId, {
        targetAppId,
        targetUnionId,
        openId,
        addedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      logger.info(
        `注册 chat=${chatId} viewer=${viewerAppId} target=${targetAppId} union=${targetUnionId} openId=${openId ?? '(unknown)'}`,
      );
    }
  }

  /**
   * 标记 target bot 出群（所有 viewer 视角下都移除）
   *
   * 入群事件回调里只有 targetAppId，没法精确到 union_id；按 appId 全量清理。
   */
  unregisterBotInChat(chatId: string, targetAppId: string): void {
    if (!chatId || !targetAppId) return;
    const chatLevel = this.byChatId.get(chatId);
    if (chatLevel) {
      for (const [viewerAppId, viewerLevel] of chatLevel) {
        for (const [unionId, entry] of viewerLevel) {
          if (entry.targetAppId === targetAppId) {
            viewerLevel.delete(unionId);
            logger.info(
              `注销 chat=${chatId} viewer=${viewerAppId} target_app=${targetAppId} union=${unionId}`,
            );
          }
        }
        if (viewerLevel.size === 0) chatLevel.delete(viewerAppId);
      }
      if (chatLevel.size === 0) this.byChatId.delete(chatId);
    }
    // 同步清占位 set
    const viewerMap = this.chatViewerSeenAppIds.get(chatId);
    if (viewerMap) {
      for (const appIdSet of viewerMap.values()) {
        appIdSet.delete(targetAppId);
      }
    }
  }

  /** 移除整个群（群被解散时） */
  invalidateChat(chatId: string): void {
    if (this.byChatId.delete(chatId) || this.chatViewerSeenAppIds.delete(chatId)) {
      logger.debug(`清空群 ${chatId}`);
    }
  }

  /**
   * 清理超过 maxAgeMs（默认 30 天）未活跃的 entry
   */
  gc(maxAgeMs = 30 * 24 * 60 * 60_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [chatId, chatLevel] of this.byChatId) {
      for (const [viewerAppId, viewerLevel] of chatLevel) {
        for (const [unionId, entry] of viewerLevel) {
          if (entry.lastSeenAt < cutoff) {
            viewerLevel.delete(unionId);
            removed++;
          }
        }
        if (viewerLevel.size === 0) chatLevel.delete(viewerAppId);
      }
      if (chatLevel.size === 0) this.byChatId.delete(chatId);
    }
    if (removed > 0) {
      logger.info(`peer-bot-registry GC 清理 ${removed} 个超过 ${maxAgeMs / 86_400_000}d 未活跃 entry`);
    }
    return removed;
  }

  /**
   * 列出群里所有 EvoClaw 同事 bot（**指定 viewer 视角**）
   *
   * @param chatId 群 ID
   * @param viewerAccountId 调用方本机 App ID（cli_xxx）；调用方期望从这个 App
   *   的视角拿到 peer 的 openId
   * @param selfAgentId 排除自己用
   *
   * 解析步骤：
   *   1. 查 viewer 视角下已观察到的 (targetUnionId → entry) → 提供完整 openId
   *   2. 占位 set 里 viewer 见过但还没升级的 targetAppId → 仅返回 agentId，
   *      openId 为 undefined（让调用方降级纯文本 @<name>）
   *   3. **不再用 binding.bot_open_id 兜底**——那是 target 自己视角的 openId，
   *      在 viewer 视角用必定跨 app 报错
   */
  listInChat(chatId: string, viewerAccountId: string, selfAgentId: string): PeerBotLookup[] {
    const allBindings = this.bindingRouter.listBindings().filter((b) => b.channel === 'feishu');
    const accountToAgent = new Map<string, string>();
    for (const b of allBindings) {
      if (b.accountId) accountToAgent.set(b.accountId, b.agentId);
    }

    const result: PeerBotLookup[] = [];
    const seenAgentIds = new Set<string>();

    // Step 1: viewer 视角下完整 entry（有 openId 的）
    const chatLevel = this.byChatId.get(chatId);
    const viewerLevel = chatLevel?.get(viewerAccountId);
    if (viewerLevel) {
      for (const entry of viewerLevel.values()) {
        const agentId = accountToAgent.get(entry.targetAppId);
        if (!agentId || agentId === selfAgentId) continue;
        if (seenAgentIds.has(agentId)) continue;
        seenAgentIds.add(agentId);
        result.push({
          agentId,
          appId: entry.targetAppId,
          unionId: entry.targetUnionId,
          openId: entry.openId,
        });
      }
    }

    // Step 2: viewer 占位 set 里见过但没升级的 targetAppId（openId undefined）
    const viewerMap = this.chatViewerSeenAppIds.get(chatId);
    const seenAppIds = viewerMap?.get(viewerAccountId);
    if (seenAppIds) {
      for (const targetAppId of seenAppIds) {
        const agentId = accountToAgent.get(targetAppId);
        if (!agentId || agentId === selfAgentId) continue;
        if (seenAgentIds.has(agentId)) continue;
        seenAgentIds.add(agentId);
        result.push({ agentId, appId: targetAppId });   // openId 缺，调用方降级
      }
    }

    // Step 3: 本地 binding 里其他 feishu agent —— 即使从未观察到也加 candidate
    // （冷启动场景：plan 派活时让 LLM 知道有这位同事，至少能用纯文本 @ 告知）
    for (const [appId, agentId] of accountToAgent) {
      if (agentId === selfAgentId) continue;
      if (seenAgentIds.has(agentId)) continue;
      result.push({ agentId, appId });   // openId 缺，调用方降级纯文本
    }

    return result;
  }

  /**
   * 反查：某 viewer 视角下，sender (chatId, senderAppId) 是不是已知 EvoClaw 同事
   *
   * 用于 inbound classifyInboundMessage 的 'peer' 判定。
   *
   * 副作用：识别成功时把 (viewerAccountId, sender) 写进 registry，让后续 listInChat
   * 在该 viewer 视角下能看到完整 openId。
   *
   * @param viewerAccountId 收到这条消息的本机 App ID
   * @param chatId 群 ID
   * @param senderAppId 发送方 bot 的 App ID（cli_xxx）
   * @param senderOpenId 发送方在 **viewer 视角下** 的 open_id（来自事件 sender_id.open_id）
   * @param senderUnionId 发送方 union_id（来自事件 sender_id.union_id，跨 viewer 稳定）
   */
  classifyPeer(args: {
    viewerAccountId: string;
    chatId: string;
    senderAppId: string;
    senderOpenId?: string;
    senderUnionId?: string;
  }): { agentId: string; openId?: string; unionId?: string } | null {
    const { viewerAccountId, chatId, senderAppId, senderOpenId, senderUnionId } = args;
    if (!chatId || !senderAppId || !viewerAccountId) return null;
    const allBindings = this.bindingRouter.listBindings().filter((b) => b.channel === 'feishu');
    const binding = allBindings.find((b) => b.accountId === senderAppId);
    if (!binding) return null;

    // 副作用：viewer 视角下学到 sender 信息
    this.registerBotInChat({
      chatId,
      viewerAppId: viewerAccountId,
      targetAppId: senderAppId,
      targetUnionId: senderUnionId,
      openId: senderOpenId,
    });

    // 拿当前 viewer 视角下的 entry（升级过的）
    const entry = this.byChatId.get(chatId)?.get(viewerAccountId)?.get(senderUnionId ?? '');
    return {
      agentId: binding.agentId,
      openId: entry?.openId ?? senderOpenId,
      unionId: entry?.targetUnionId ?? senderUnionId,
    };
  }

  /** 测试 / 紧急回退用：清空所有数据 */
  reset(): void {
    this.byChatId.clear();
    this.chatViewerSeenAppIds.clear();
  }
}
