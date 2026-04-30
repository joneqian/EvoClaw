/**
 * FeishuTeamChannel —— TeamChannelAdapter 飞书实现（M13 PR3）
 *
 * 责任：
 *   - classifyInboundMessage：把入站事件分到 self/peer/stranger/user
 *   - listPeerBots：列出群里的 EvoClaw 同事 bot（被动缓存模式，飞书 API 不返回 bot 成员）
 *   - buildMention：构造带 @ 的消息体（PR3 仅 fallbackText；PR4+ 再做真·post 原生 @）
 *   - renderTaskBoard / updateTaskBoard：CardKit 卡片（PR3 基础版）
 *   - onGroupMembershipChanged：订阅成员变更事件，触发 peer-roster 缓存失效
 *
 * 飞书 chat.members.get 不返回机器人成员（SDK 文档明确说明），所以 listPeerBots 走
 * 被动缓存（FeishuPeerBotRegistry）。具体降级规则见 docs/architecture/team-mode-channel-guide.md
 */

import { createLogger } from '../../../infrastructure/logger.js';
import type {
  ChannelOutboundMessage,
  GroupSessionKey,
  MessageClassification,
  OwnBotContext,
  PeerBotIdentity,
  PeerBotInfo,
  TaskPlanSnapshot,
  TeamChannelAdapter,
  TeamMessageMetadata,
} from '../../team-mode/team-channel.js';
import type * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuPeerBotRegistry } from './common/peer-bot-registry.js';
import type { BindingRouter } from '../../../routing/binding-router.js';
import { ChatHistoryProberCache } from './inbound/chat-history-prober.js';
import { renderTaskBoardCard, renderTaskBoardCardJson } from './card/task-board-card.js';

const logger = createLogger('feishu/team-channel');

/**
 * 飞书入站消息原始结构（仅取本接口用到的字段）
 */
export interface FeishuInboundLike {
  sender?: {
    sender_type?: string; // 'user' | 'app'
    sender_id?: { open_id?: string; user_id?: string; union_id?: string; app_id?: string };
  };
  message?: {
    chat_id?: string;
    chat_type?: string;
  };
}

export interface FeishuTeamChannelDeps {
  peerBotRegistry: FeishuPeerBotRegistry;
  /** M13 cross-app 修复：用 agentId 反查 viewer 视角的 accountId（飞书 App ID） */
  bindingRouter: BindingRouter;
  /**
   * M13 cross-app 修复 — 主动拉历史消息 prober：
   * 给定 viewer accountId 返回该 App 的 Lark client（用于调 messages.list API）。
   * 未连接 / 未注册时返回 null，prober 静默跳过。
   */
  getLarkClientByAccountId?: (accountId: string) => Lark.Client | null;
  /** prober 缓存 TTL（毫秒，默认 24h），测试可缩短 */
  proberTtlMs?: number;
}

export class FeishuTeamChannel implements TeamChannelAdapter {
  readonly channelType = 'feishu';
  private deps: FeishuTeamChannelDeps;
  private membershipHandlers = new Set<(key: GroupSessionKey) => void>();

  private proberCache: ChatHistoryProberCache;

  constructor(deps: FeishuTeamChannelDeps) {
    this.deps = deps;
    this.proberCache = new ChatHistoryProberCache(deps.proberTtlMs);
  }

  // ─── classifyInboundMessage ────────────────────────────────

  async classifyInboundMessage(
    rawEvent: unknown,
    own: OwnBotContext,
  ): Promise<MessageClassification> {
    const event = rawEvent as FeishuInboundLike;
    const sender = event.sender;
    if (!sender || !sender.sender_id) {
      return { kind: 'stranger', reason: 'no-sender' };
    }
    const senderType = sender.sender_type;
    const senderOpenId = sender.sender_id.open_id;
    const chatId = event.message?.chat_id;

    if (senderType === 'user') {
      return { kind: 'user', userId: senderOpenId ?? '' };
    }
    if (senderType !== 'app') {
      return { kind: 'stranger', reason: `unknown sender_type=${senderType}` };
    }

    const senderAppId = sender.sender_id.app_id;
    if (!senderAppId) {
      return { kind: 'stranger', reason: 'app-without-app_id' };
    }

    // self
    if (own.accountId && senderAppId === own.accountId) {
      return { kind: 'self', reason: 'echo' };
    }

    // peer：查 registry（用 own.accountId 作为 viewer 视角）
    if (chatId && own.accountId) {
      const senderUnionId = sender.sender_id?.union_id;
      const peer = this.deps.peerBotRegistry.classifyPeer({
        viewerAccountId: own.accountId,
        chatId,
        senderAppId,
        senderOpenId,
        senderUnionId,
      });
      if (peer) {
        logger.debug(
          `classify peer chat=${chatId} viewer=${own.accountId} app=${senderAppId} → agent=${peer.agentId}`,
        );
        return { kind: 'peer', senderAgentId: peer.agentId };
      }
    }
    return { kind: 'stranger', reason: 'app-not-in-bindings' };
  }

  // ─── listPeerBots ──────────────────────────────────────────

  async listPeerBots(
    groupSessionKey: GroupSessionKey,
    selfAgentId: string,
  ): Promise<PeerBotIdentity[]> {
    const chatId = parseChatIdFromKey(groupSessionKey);
    if (!chatId) {
      logger.warn(`listPeerBots groupSessionKey 格式错误 key=${groupSessionKey}`);
      return [];
    }
    // M13 cross-app 修复：viewer = self agent 的 feishu accountId
    const viewerBindings = this.deps.bindingRouter
      .listBindings(selfAgentId)
      .filter((b) => b.channel === 'feishu');
    const viewerAccountId = viewerBindings[0]?.accountId ?? '';
    if (!viewerAccountId) {
      logger.warn(`listPeerBots 找不到 self agent 的 feishu binding agentId=${selfAgentId}`);
      return [];
    }

    // M13 cross-app 修复 — 历史消息回溯（per (chatId, viewerAccountId) 24h TTL）：
    // 拉群最近 50 条消息，从 sender_type='app' 的消息里提取其他 bot 在 viewer 视角下的 open_id，
    // 写入 registry。这是 cold-start 主路径——一次 API 调用补齐"过去说过话的所有同事"。
    const client = this.deps.getLarkClientByAccountId?.(viewerAccountId);
    if (client) {
      try {
        await this.proberCache.probeOnce({
          client,
          chatId,
          viewerAccountId,
          bindingRouter: this.deps.bindingRouter,
          registry: this.deps.peerBotRegistry,
        });
      } catch (err) {
        // probeOnce 内部已 try/catch；这里再保险，确保 listPeerBots 主流程不被打断
        logger.warn(
          `prober 抛错（已忽略）chat=${chatId} viewer=${viewerAccountId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const peers = this.deps.peerBotRegistry.listInChat(chatId, viewerAccountId, selfAgentId);
    return peers.map((p) => ({
      agentId: p.agentId,
      // openId 是飞书 `<at>` 用的；尚未学到 viewer 视角时为空字符串。
      // 调用方（peer-roster / mention_peer）应检测空 mentionId 降级为纯文本 @<name>，
      // 不能用 appId / 别 viewer 的 openId 兜底（必跨 app 报错）。
      mentionId: p.openId ?? '',
    }));
  }

  // ─── buildMention ──────────────────────────────────────────

  async buildMention(
    groupSessionKey: GroupSessionKey,
    peer: PeerBotInfo,
    text: string,
    metadata?: TeamMessageMetadata,
  ): Promise<ChannelOutboundMessage> {
    // PR5 修复（S2）：用 `<at user_id="ou_xxx"/>` 内联标记，
    // 经 markdown-to-post.ts 渲染为真·post `at` 元素，飞书会触发推送通知 + 高亮
    //
    // 兼容性：
    //   - mentionId 是 open_id 时（peer 已 active 过）→ 真 @ 生效
    //   - mentionId 退化为 appId 时（peer 还未在群里发过言）→ at 元素的 user_id
    //     是 cli_xxx，飞书不识别，但消息仍会发出（fallback：纯文本含 name）
    const isValidOpenId = peer.mentionId.startsWith('ou_') || peer.mentionId.startsWith('on_');
    const atSegment = isValidOpenId
      ? `<at user_id="${peer.mentionId}"/>`
      : `@${peer.name}`; // openId 未学到时退到 plain @
    const content = `${atSegment} ${text}`;
    // fallbackText 给 channelManager.sendMessage 用（纯字符串路径），
    // markdown-to-post.looksLikeMarkdown 看到 `<at user_id=` 会走 post 渲染
    logger.debug(
      `buildMention group=${groupSessionKey} peer=${peer.agentId} mention_id=${peer.mentionId} ` +
        `mode=${isValidOpenId ? 'native_at' : 'plain_at'} text_bytes=${text.length}`,
    );
    return {
      channelType: this.channelType,
      fallbackText: content,
      payload: null, // 路由 hint：用 fallbackText 通过 sendSmartMessage 自动转 post
      metadata,
    };
  }

  // ─── renderTaskBoard / updateTaskBoard ─────────────────────

  renderTaskBoard(plan: TaskPlanSnapshot): ChannelOutboundMessage {
    const cardJson = renderTaskBoardCardJson(plan);
    return {
      channelType: this.channelType,
      fallbackText: renderTaskBoardCard(plan),
      payload: cardJson,
    };
  }

  async updateTaskBoard(
    groupSessionKey: GroupSessionKey,
    existingCardId: string | null,
    plan: TaskPlanSnapshot,
  ): Promise<{ cardId: string }> {
    // PR3 占位：还没接 CardKit streaming 实际更新；返回 existingCardId 或空
    // PR4 接 cardkit.append/update 真做原地更新
    logger.debug(
      `updateTaskBoard（PR3 占位）group=${groupSessionKey} existing=${existingCardId} plan=${plan.id}`,
    );
    return { cardId: existingCardId ?? '' };
  }

  // ─── 成员变更订阅 ───────────────────────────────────────────

  onGroupMembershipChanged(handler: (key: GroupSessionKey) => void): void {
    this.membershipHandlers.add(handler);
  }

  /**
   * 由 adapter index.ts 在收到飞书事件时调用 → 触发订阅者
   *
   * - eventKind: 'added' / 'deleted' / 'p2p_entered'
   */
  notifyMembershipChange(chatId: string, eventKind: 'added' | 'deleted' | 'p2p_entered'): void {
    if (!chatId) return;
    const groupKey = `feishu:chat:${chatId}` as GroupSessionKey;
    logger.debug(`成员变更广播 ${eventKind} group=${groupKey}`);
    for (const h of this.membershipHandlers) {
      try {
        h(groupKey);
      } catch (err) {
        logger.error('membership handler 抛错', err);
      }
    }
  }
}

/**
 * "feishu:chat:oc_xxx" → "oc_xxx"
 */
function parseChatIdFromKey(key: GroupSessionKey): string | null {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  if (key.slice(0, idx) !== 'feishu') return null;
  // 之后形如 "chat:oc_xxx"
  const idx2 = key.indexOf(':', idx + 1);
  if (idx2 <= idx) return null;
  return key.slice(idx2 + 1);
}
