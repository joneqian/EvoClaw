/**
 * Chat History Prober — 入站时主动拉群历史消息回溯，补齐 viewer 视角下其他 bot 的 open_id
 *
 * 背景（M13 cross-app 修复主路径）：
 *   飞书 open_id 是 app-scoped——A 想 @ B 必须用 A's App namespace 下的 ou_xxx。
 *   被动 path 只能从入站事件 sender_id 学到 viewer 视角；冷启动时 B 没说过话就没法 @。
 *
 *   `/im/v1/chats/{chat_id}/members` 不返回 bot；`/contact/v3/users` 也不含 bot。
 *   **唯一可用的主动 API 是 `/im/v1/messages?container_id_type=chat`**——拉群历史消息，
 *   返回的每条消息 `sender.id.open_id` 是**调用方 App 视角**下的 open_id（飞书标准
 *   行为：API 返回字段都按调用方 namespace 翻译）。一次调用可补齐"近 N 条消息内
 *   说过话的所有 bot 在 viewer 视角下的 open_id"。
 *
 * 触发时机（由 caller 决定）：
 *   - 入站消息处理时，per (chatId, viewerAccountId) 首次或 TTL 过期时调一次
 *   - mention_peer cold-start 时按需触发
 *
 * 限制：从未在群里说过话的 bot 仍学不到（极端 case，需要其他兜底）。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { createLogger } from '../../../../infrastructure/logger.js';
import type { BindingRouter } from '../../../../routing/binding-router.js';
import type { FeishuPeerBotRegistry } from '../common/peer-bot-registry.js';

const log = createLogger('feishu/chat-history-prober');

/** 单条历史消息的 sender 字段（仅取我们关心的） */
interface HistoryMessageItem {
  message_id?: string;
  sender?: {
    sender_type?: string;          // 'user' | 'app'
    sender_id?: {
      open_id?: string;            // viewer 视角下的 open_id（**关键**）
      user_id?: string;
      union_id?: string;
      app_id?: string;
    };
    /** SDK 兼容：某些版本 sender 用 id 字段而非 sender_id */
    id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
      app_id?: string;
    };
  };
}

interface MessageListResponse {
  code?: number;
  msg?: string;
  data?: {
    has_more?: boolean;
    page_token?: string;
    items?: HistoryMessageItem[];
  };
}

export interface ProbeChatHistoryArgs {
  client: Lark.Client;
  chatId: string;
  /** 调用方（viewer）的 feishu accountId（cli_xxx），决定 registry 的 viewer 维度 key */
  viewerAccountId: string;
  bindingRouter: BindingRouter;
  registry: FeishuPeerBotRegistry;
  /** 单次拉取条数，默认 50（飞书 API 上限 50） */
  pageSize?: number;
  /** 最多翻页次数，默认 1（拉最近 50 条够覆盖大多数群） */
  maxPages?: number;
}

export interface ProbeChatHistoryResult {
  scanned: number;
  learned: number;
  /** learned 里按 agentId 去重的 EvoClaw 同事数 */
  learnedAgents: number;
  durationMs: number;
}

/**
 * 拉群历史消息，提取每条 bot 发言的 sender 信息写入 registry
 *
 * 失败兜底：catch 所有异常吞掉返回零结果——主路径继续走被动学习
 */
export async function probeChatHistory(args: ProbeChatHistoryArgs): Promise<ProbeChatHistoryResult> {
  const startMs = Date.now();
  const pageSize = args.pageSize ?? 50;
  const maxPages = args.maxPages ?? 1;

  const allBindings = args.bindingRouter.listBindings().filter((b) => b.channel === 'feishu');
  const accountToAgent = new Map<string, string>();
  for (const b of allBindings) {
    if (b.accountId) accountToAgent.set(b.accountId, b.agentId);
  }

  let scanned = 0;
  let learned = 0;
  const learnedAgentIds = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    let response: MessageListResponse;
    try {
      // 走 client.request 低层 API：SDK 高层 client.im.message.list 在 Bun runtime
      // 下会触发 "socket closed unexpectedly" 错误（OpenClaw 同样踩过这坑，注释见
      // feishu/index.ts defaultHydrateBotOpenId）。低层 API 正常。
      response = (await args.client.request({
        method: 'GET',
        url: '/open-apis/im/v1/messages',
        params: {
          container_id_type: 'chat',
          container_id: args.chatId,
          sort_type: 'ByCreateTimeDesc',
          page_size: pageSize,
          // 验证：飞书 messages.list 是否对 bot sender 也按 user_id_type 返回 open_id
          // 之前默认参数下 id_type='app_id'，这次显式 open_id 看会不会变
          user_id_type: 'open_id',
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      })) as MessageListResponse;
    } catch (err) {
      log.warn(
        `messages.list 抛错 chat=${args.chatId} viewer=${args.viewerAccountId} page=${page}: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }

    if (response.code !== 0) {
      log.warn(
        `messages.list 业务错 chat=${args.chatId} viewer=${args.viewerAccountId} code=${response.code} msg=${response.msg}`,
      );
      break;
    }

    const items = response.data?.items ?? [];
    scanned += items.length;
    let debugSampleLogged = false;
    for (const msg of items) {
      const sender = msg.sender as
        | { sender_type?: string; sender_id?: { open_id?: string; user_id?: string; union_id?: string; app_id?: string }; id?: string | { open_id?: string; app_id?: string; union_id?: string }; id_type?: string; tenant_key?: string }
        | undefined;
      if (sender?.sender_type !== 'app') continue;

      // 飞书消息 API（messages.list）返回的 sender 跟入站事件**字段名不同**：
      //   入站事件: sender.sender_id.{open_id, app_id, union_id}（多字段对象）
      //   messages.list: sender.{id, id_type, sender_type, tenant_key}（id 是字符串）
      // 调用方 user_id_type 参数决定 id 的语义（默认 open_id）
      let senderAppId: string | undefined;
      let senderOpenId: string | undefined;
      let senderUnionId: string | undefined;

      if (typeof sender.id === 'string') {
        // messages.list 形式：id 是字符串，根据 id_type 解析
        const idStr = sender.id;
        if (sender.id_type === 'app_id') senderAppId = idStr;
        else if (sender.id_type === 'union_id') senderUnionId = idStr;
        else if (sender.id_type === 'open_id') senderOpenId = idStr;
        else senderOpenId = idStr;  // 默认假设 open_id
      } else {
        // 入站事件 / 旧格式：sender_id 或 id 是对象
        const idObj = sender.sender_id ?? (sender.id as { open_id?: string; app_id?: string; union_id?: string } | undefined);
        senderAppId = idObj?.app_id;
        senderOpenId = idObj?.open_id;
        senderUnionId = idObj?.union_id;
      }

      // 首条样本 dump 出来便于调试新结构（一次 probe 仅打一次）
      if (!debugSampleLogged) {
        debugSampleLogged = true;
        log.info(
          `prober sender 样本（首条 sender_type=app）chat=${args.chatId} viewer=${args.viewerAccountId}: ${JSON.stringify(sender)}`,
        );
      }

      // 反查 agentId：优先 app_id（最可靠），其次 open_id（viewer 视角下的 self-view 比对）
      let agentId: string | undefined;
      if (senderAppId) {
        agentId = accountToAgent.get(senderAppId);
      }
      if (!agentId && senderOpenId) {
        // open_id 反查：messages.list 默认 id_type=open_id，且这个 open_id 是 **调用方视角**
        // 下的 open_id。要找到对应的 EvoClaw agent，可以用 binding.bot_open_id 比对——但
        // 那是 self-view，跟 viewer-view 在 cross-app 下不同！
        // 实测发现：当 viewer 调 messages.list 看自己 App 发的消息时 open_id 就是 self-view，
        // 一致；看其他 App 发的消息时 open_id 是 viewer 视角的，跟 self-view 不一致。
        // 所以这里只对 viewer === sender 场景有效，cross-app 时此反查失败。
        // TODO: 飞书 messages.list 是否支持 user_id_type=app_id？需要试。
        for (const b of allBindings) {
          if (b.botOpenId && b.botOpenId === senderOpenId) {
            agentId = b.agentId;
            senderAppId = b.accountId ?? undefined;
            break;
          }
        }
      }

      if (!agentId || !senderAppId) {
        // 调试：打一次哪条没识别出来（限频）
        if (!debugSampleLogged) {
          log.debug(
            `prober 跳过未识别的 app sender: senderAppId=${senderAppId} senderOpenId=${senderOpenId}`,
          );
        }
        continue;
      }
      if (senderAppId === args.viewerAccountId) continue;  // 自己发的消息不学

      // 缺 openId 时不写入（占位无意义——cross-app @ 仍然不可用）
      if (!senderOpenId) continue;

      args.registry.registerBotInChat({
        chatId: args.chatId,
        viewerAppId: args.viewerAccountId,
        targetAppId: senderAppId,
        targetUnionId: senderUnionId,
        openId: senderOpenId,
      });
      learned++;
      learnedAgentIds.add(agentId);
    }

    if (!response.data?.has_more || !response.data?.page_token) break;
    pageToken = response.data.page_token;
  }

  const durationMs = Date.now() - startMs;
  log.info(
    `prober chat=${args.chatId} viewer=${args.viewerAccountId} scanned=${scanned} learned=${learned} agents=${learnedAgentIds.size} duration_ms=${durationMs}`,
  );
  return { scanned, learned, learnedAgents: learnedAgentIds.size, durationMs };
}

/**
 * (chatId, viewerAccountId) 级 throttle 缓存——同一对组合在 TTL 内不重复 probe
 *
 * 实现：进程内 Map，cleanup 由 Map 大小自然边界（每 chat × bot 数量有限）
 */
export class ChatHistoryProberCache {
  private lastProbedAt = new Map<string, number>();
  private inFlight = new Map<string, Promise<ProbeChatHistoryResult>>();

  /** 默认 24h TTL */
  private readonly ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60_000) {
    this.ttlMs = ttlMs;
  }

  /**
   * 触发 probe（如未命中缓存）；返回 Promise 给调用方异步等待 / 忽略
   *
   * 多次同 key 并发触发只会发一次 RPC（in-flight 去重）
   */
  async probeOnce(args: ProbeChatHistoryArgs): Promise<ProbeChatHistoryResult | null> {
    const key = `${args.chatId}|${args.viewerAccountId}`;
    const now = Date.now();
    const last = this.lastProbedAt.get(key);
    if (last && now - last < this.ttlMs) {
      return null;  // TTL 内不重复 probe
    }
    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const p = (async () => {
      try {
        const result = await probeChatHistory(args);
        this.lastProbedAt.set(key, Date.now());
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }

  /** 测试 / 紧急回退用：清空缓存 */
  reset(): void {
    this.lastProbedAt.clear();
    this.inFlight.clear();
  }
}
