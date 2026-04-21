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
export interface PendingApproval {
  actionId: string;
  sessionKey: string;
  operatorOpenId?: string;
  messageId: string | null;
  /** 原卡片标题（用于 resolve 后保留上下文） */
  title: string;
  /** 原卡片正文 */
  body: string;
  createdAt: number;
  expiresAt: number;
  resolve: (decision: ApprovalDecision, operatorOpenId?: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 审批注册表：actionId → pending 记录 */
export class ApprovalRegistry {
  private pending = new Map<string, PendingApproval>();
  private counter = 0;
  private closed = false;

  /** 生成唯一 actionId（短标识 + 时间戳 + 递增，避免攻击者枚举） */
  nextActionId(): string {
    this.counter += 1;
    const rand = Math.random().toString(36).slice(2, 10);
    return `ap_${Date.now().toString(36)}_${this.counter}_${rand}`;
  }

  /** 注册 pending；若 registry 已关闭立即 resolve('timeout') */
  register(entry: PendingApproval): void {
    if (this.closed) {
      clearTimeout(entry.timer);
      entry.resolve('timeout');
      return;
    }
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

  /** 通过 actionId 查询 pending（只读，不删除） */
  peek(actionId: string): PendingApproval | null {
    return this.pending.get(actionId) ?? null;
  }

  /** 取消所有待审批（用于 disconnect 清理），并标记 registry 关闭 */
  cancelAll(reason: 'timeout' = 'timeout'): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(reason);
    }
    this.pending.clear();
  }

  /** 重连成功后重新启用（允许再次 register） */
  reopen(): void {
    this.closed = false;
  }

  get size(): number {
    return this.pending.size;
  }

  get isClosed(): boolean {
    return this.closed;
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
            text: { tag: 'plain_text', content: '批准' },
            type: 'primary',
            value: approveEnvelope,
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '拒绝' },
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
      ? `已批准${params.operatorOpenId ? `（操作者 ${params.operatorOpenId}）` : ''}`
      : params.decision === 'deny'
      ? `已拒绝${params.operatorOpenId ? `（操作者 ${params.operatorOpenId}）` : ''}`
      : '已超时';
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
/** 审批默认 TTL：24 小时（需要足够长以容忍用户延迟响应） */
export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export async function requestApprovalViaCard(
  client: Lark.Client,
  registry: ApprovalRegistry,
  params: {
    peerId: string;
    chatType?: 'private' | 'group';
  } & ApprovalRequestOptions,
): Promise<{ decision: ApprovalDecision; operatorOpenId?: string }> {
  const actionId = registry.nextActionId();
  const ttlMs = params.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;

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
        // 卡片自动更新为"已超时"状态（保留原 title/body，失败不影响结果返回）
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
      title: params.title,
      body: params.body,
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
