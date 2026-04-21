/**
 * card.action.trigger 事件处理
 *
 * 路由飞书卡片按钮点击事件：
 * - 取 action.value 作 envelope，校验版本 / 过期 / session / operator
 * - kind='approval' → 分发到 ApprovalRegistry
 * - 其他 kind 可扩展（未来 Phase：command 等）
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import type { ApprovalRegistry } from './send-approval.js';
import { decodeEnvelope, FEISHU_ENVELOPE_VERSION } from './card-envelope.js';
import { buildResolvedApprovalCard } from './send-approval.js';
import { updateInteractiveCard } from './send-card.js';
import { createLogger } from '../../../infrastructure/logger.js';

const log = createLogger('feishu-card-action');

/** card.action.trigger 事件载荷（SDK 类型的必要子集） */
export interface FeishuCardActionEvent {
  operator?: {
    open_id?: string;
    user_id?: string;
  };
  context?: {
    open_message_id?: string;
    open_chat_id?: string;
  };
  action?: {
    tag?: string;
    value?: unknown;
  };
  /** 部分事件把 message_id 放在顶层 */
  open_message_id?: string;
}

/** card action 处理上下文 */
export interface CardActionContext {
  getRegistry: () => ApprovalRegistry | null;
  getClient: () => Lark.Client | null;
}

/** 注册 card.action.trigger 事件处理器 */
export function registerCardActionHandlers(
  dispatcher: Lark.EventDispatcher,
  ctx: CardActionContext,
): Lark.EventDispatcher {
  // SDK 的 register 接受泛型 handles 对象；card.action.trigger 在 IHandles 中定义
  dispatcher.register({
    'card.action.trigger': async (data: FeishuCardActionEvent) => {
      await handleCardAction(data, ctx);
    },
  } as unknown as Parameters<typeof dispatcher.register>[0]);
  return dispatcher;
}

/**
 * 处理一次卡片按钮点击
 *
 * 返回值留空（飞书客户端读 handler 返回值可以替换卡片；
 * 我们用主动 patch 路径，返回 undefined 保持兼容）。
 */
export async function handleCardAction(
  data: FeishuCardActionEvent,
  ctx: CardActionContext,
): Promise<void> {
  const value = data.action?.value;
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  // 非 ecf1 envelope 直接忽略（可能来自外部 / 其他插件）
  if (record['oc'] !== FEISHU_ENVELOPE_VERSION) return;

  const operatorOpenId = data.operator?.open_id;
  const decoded = decodeEnvelope<{ decision?: 'approve' | 'deny' }>(
    record,
    operatorOpenId ? { operatorOpenId } : undefined,
  );

  if (!decoded.ok) {
    log.warn(`卡片 action 被拒：${decoded.reason} actionId=${String(record['a'])}`);
    return;
  }

  const env = decoded.envelope;
  if (env.k !== 'approval') {
    // 其他 kind（未来扩展）
    return;
  }

  const decision = env.m?.decision === 'deny' ? 'deny' : 'approve';

  const registry = ctx.getRegistry();
  if (!registry) return;

  // resolve 前先 peek，拿到原 title/body 以复用在结算卡中
  const entry = registry.resolveAction(env.a, decision, operatorOpenId);
  if (!entry) return;

  // 尝试把卡片更新为"已批准 / 已拒绝"状态（保留原标题与正文，失败不影响结果）
  const client = ctx.getClient();
  const messageId = entry.messageId ?? data.open_message_id ?? data.context?.open_message_id;
  if (!client || !messageId) {
    log.warn(
      `无 client/messageId，卡片状态未更新 actionId=${env.a} decision=${decision}`,
    );
    return;
  }

  updateInteractiveCard(
    client,
    messageId,
    buildResolvedApprovalCard({
      title: entry.title,
      body: entry.body,
      decision,
      ...(operatorOpenId ? { operatorOpenId } : {}),
    }),
  ).catch((err) => {
    log.warn(`卡片更新失败：${err instanceof Error ? err.message : err}`);
  });
}
