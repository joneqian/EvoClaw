/**
 * 审批卡片
 *
 * 高层 API：adapter.requestApproval(peerId, options) → 发送审批卡 → 等待用户点按钮 →
 * 返回 {decision: 'approve'|'deny', operatorOpenId}。超时未回则 timeout。
 *
 * 设计：卡片 envelope kind='approval'，按钮 value 附带 actionId，
 *       actionId 映射到 ApprovalRegistry 中的 pending Promise。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { createEnvelope, type FeishuCardEnvelope } from './card-envelope.js';
import { sendInteractiveCard, updateInteractiveCard, type FeishuCard } from './send-card.js';

/** 审批结果 */
export type ApprovalDecision = 'approve' | 'deny' | 'timeout';

/** 一次审批请求的配置 */
export interface ApprovalRequestOptions {
  /** 会话 key（与 ChannelMessage.peerId 的业务 session 对应） */
  sessionKey: string;
  /** 标题（卡片 header.title） */
  title: string;
  /** Markdown 正文（放到 div/markdown 元素） */
  body: string;
  /** 卡片 header.template 主题色（默认 orange） */
  template?: FeishuCard['header'] extends { template?: infer T } ? T : never;
  /** TTL 毫秒（默认 10 分钟） */
  ttlMs?: number;
  /** 限定的操作者 open_id（不传则任何群成员可点） */
  operatorOpenId?: string;
}

/** 存在 registry 中的待审批记录 */
interface PendingApproval {
  actionId: string;
  sessionKey: string;
  operatorOpenId?: string;
  messageId: string | null;
  createdAt: number;
  expiresAt: number;
  resolve: (decision: ApprovalDecision, operatorOpenId?: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 审批注册表：actionId → pending 记录 */
export class ApprovalRegistry {
  private pending = new Map<string, PendingApproval>();
  private counter = 0;

  /** 生成唯一 actionId */
  nextActionId(): string {
    this.counter += 1;
    return `ap_${Date.now()}_${this.counter}`;
  }

  register(entry: PendingApproval): void {
    this.pending.set(entry.actionId, entry);
  }

  resolveAction(actionId: string, decision: ApprovalDecision, operatorOpenId?: string): PendingApproval | null {
    const entry = this.pending.get(actionId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.pending.delete(actionId);
    entry.resolve(decision, operatorOpenId);
    return entry;
  }

  /** 取消所有待审批（用于 disconnect 清理） */
  cancelAll(reason: 'timeout' = 'timeout'): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(reason);
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}

/** 构造审批卡 JSON */
export function buildApprovalCard(params: {
  title: string;
  body: string;
  actionId: string;
  sessionKey: string;
  operatorOpenId?: string;
  template?: NonNullable<FeishuCard['header']>['template'];
  ttlMs?: number;
}): FeishuCard {
  const approveEnvelope: FeishuCardEnvelope<{ decision: 'approve' }> = createEnvelope({
    kind: 'approval',
    actionId: params.actionId,
    sessionKey: params.sessionKey,
    ...(params.operatorOpenId ? { operatorOpenId: params.operatorOpenId } : {}),
    metadata: { decision: 'approve' },
    ...(params.ttlMs !== undefined ? { ttlMs: params.ttlMs } : {}),
  });
  const denyEnvelope: FeishuCardEnvelope<{ decision: 'deny' }> = createEnvelope({
    kind: 'approval',
    actionId: params.actionId,
    sessionKey: params.sessionKey,
    ...(params.operatorOpenId ? { operatorOpenId: params.operatorOpenId } : {}),
    metadata: { decision: 'deny' },
    ...(params.ttlMs !== undefined ? { ttlMs: params.ttlMs } : {}),
  });

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: params.title },
      template: params.template ?? 'orange',
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: params.body },
      },
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✅ 批准' },
            type: 'primary',
            value: approveEnvelope,
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '❌ 拒绝' },
            type: 'danger',
            value: denyEnvelope,
          },
        ],
      },
    ],
  };
}

/** 审批结算后的"已完成"状态卡（替换按钮区） */
export function buildResolvedApprovalCard(params: {
  title: string;
  body: string;
  decision: ApprovalDecision;
  operatorOpenId?: string;
}): FeishuCard {
  const statusText =
    params.decision === 'approve'
      ? `✅ 已批准${params.operatorOpenId ? `（操作者 ${params.operatorOpenId}）` : ''}`
      : params.decision === 'deny'
      ? `❌ 已拒绝${params.operatorOpenId ? `（操作者 ${params.operatorOpenId}）` : ''}`
      : '⏱ 已超时';
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: params.title },
      template:
        params.decision === 'approve'
          ? 'green'
          : params.decision === 'deny'
          ? 'red'
          : 'grey',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: params.body } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'plain_text', content: statusText } },
    ],
  };
}

/**
 * 发起审批：发送卡片 + 返回 Promise（resolve 为 approve/deny/timeout）
 *
 * 内部会注册 actionId 到 registry，卡片按钮的 envelope 里带同一 actionId；
 * 到期未点则 timer 自动 resolve('timeout')。
 */
export async function requestApprovalViaCard(
  client: Lark.Client,
  registry: ApprovalRegistry,
  params: {
    peerId: string;
    chatType?: 'private' | 'group';
  } & ApprovalRequestOptions,
): Promise<{ decision: ApprovalDecision; operatorOpenId?: string }> {
  const actionId = registry.nextActionId();
  const ttlMs = params.ttlMs ?? 10 * 60 * 1000;

  const card = buildApprovalCard({
    title: params.title,
    body: params.body,
    actionId,
    sessionKey: params.sessionKey,
    ...(params.operatorOpenId ? { operatorOpenId: params.operatorOpenId } : {}),
    ...(params.template ? { template: params.template } : {}),
    ttlMs,
  });

  const messageId = await sendInteractiveCard(client, params.peerId, card, params.chatType);

  return new Promise((resolve) => {
    const createdAt = Date.now();
    const timer = setTimeout(() => {
      if (registry.resolveAction(actionId, 'timeout')) {
        // 卡片自动更新为"已超时"状态（失败不影响结果返回）
        if (messageId) {
          updateInteractiveCard(client, messageId, buildResolvedApprovalCard({
            title: params.title,
            body: params.body,
            decision: 'timeout',
          })).catch(() => {});
        }
      }
    }, ttlMs);

    registry.register({
      actionId,
      sessionKey: params.sessionKey,
      ...(params.operatorOpenId ? { operatorOpenId: params.operatorOpenId } : {}),
      messageId,
      createdAt,
      expiresAt: createdAt + ttlMs,
      resolve: (decision, operatorOpenId) => {
        const payload: { decision: ApprovalDecision; operatorOpenId?: string } = { decision };
        if (operatorOpenId) payload.operatorOpenId = operatorOpenId;
        resolve(payload);
      },
      timer,
    });
  });
}
