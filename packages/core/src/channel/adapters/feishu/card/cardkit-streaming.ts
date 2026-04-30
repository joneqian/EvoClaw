/**
 * 飞书 CardKit 流式卡片
 *
 * 典型时序：
 *   const h = await beginStreamingCard(client, peerId, { placeholder: '思考中…' });
 *   for await (const delta of llmStream) {
 *     await h.append(delta);
 *   }
 *   await h.finish();
 *
 * 失败 / 取消 / 超时：
 * - abort()：立即把卡片标记为"已取消"
 * - 60s 空闲看门狗：>60s 未调 append 自动 finish + 置超时状态
 *
 * 参考 OpenClaw extensions/feishu/src/streaming-card.ts 的结构
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { FeishuApiError, inferReceiveIdType, resolveFeishuReceiveId } from '../outbound/index.js';
import { createLogger } from '../../../../infrastructure/logger.js';

const log = createLogger('feishu-streaming');

/** 空闲看门狗默认 60s */
const DEFAULT_IDLE_WATCHDOG_MS = 60_000;

/** 流式内容元素的默认 element_id（与下方 buildInitialCard 保持一致） */
const STREAMING_ELEMENT_ID = 'body';

interface CardKitCreateResponse {
  code?: number;
  msg?: string;
  data?: { card_id?: string };
}

interface GenericSdkResponse {
  code?: number;
  msg?: string;
}

/** 发起流式卡片配置 */
export interface StreamingCardOptions {
  /** 初始占位文本（卡片发送那一刻显示的内容） */
  placeholder?: string;
  /** 卡片 header 标题（可选） */
  title?: string;
  /** 空闲看门狗毫秒数（默认 60s，<=0 关闭） */
  idleTimeoutMs?: number;
}

/** 流式卡片句柄 */
export interface StreamingCardHandle {
  /** 卡片 id（首次 start 后才有值） */
  readonly cardId: string;
  /** 飞书消息 id（发出去的 interactive 消息，用于后续删除或路由） */
  readonly messageId: string | null;
  /** 增量覆盖 body 内容（每次传"完整累计文本"） */
  append(fullText: string): Promise<void>;
  /** 正常结束（把最终内容 flush 并停看门狗） */
  finish(): Promise<void>;
  /** 主动取消（卡片变为"已取消"灰色状态） */
  abort(reason?: string): Promise<void>;
  /** 当前是否已终止（finish / abort / timeout） */
  readonly closed: boolean;
}

/** 构造初始卡片（仅含一个流式文本组件） */
function buildInitialCard(placeholder: string, title?: string): Record<string, unknown> {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: 'markdown',
      element_id: STREAMING_ELEMENT_ID,
      content: placeholder,
    },
  ];
  const card: Record<string, unknown> = {
    schema: '2.0',
    config: {
      streaming_mode: true,
      summary: { content: placeholder.slice(0, 40) },
    },
    body: { elements },
  };
  if (title) {
    card['header'] = {
      title: { tag: 'plain_text', content: title },
    };
  }
  return card;
}

/**
 * 发起流式卡片
 *
 * 3 步：create card → 发送 card 消息 → 返回 handle，调用方持续 append
 */
export async function beginStreamingCard(
  client: Lark.Client,
  peerId: string,
  options: StreamingCardOptions = {},
  chatType?: 'private' | 'group',
): Promise<StreamingCardHandle> {
  const placeholder = options.placeholder ?? '思考中…';
  const idleMs = options.idleTimeoutMs ?? DEFAULT_IDLE_WATCHDOG_MS;
  const card = buildInitialCard(placeholder, options.title);

  // 1) 创建 card 实例
  const createRes = (await client.cardkit.v1.card.create({
    data: {
      type: 'card_json',
      data: JSON.stringify(card),
    },
  })) as CardKitCreateResponse;
  if (createRes.code) {
    throw new FeishuApiError('创建流式卡片', createRes.code, createRes.msg ?? '');
  }
  const cardId = createRes.data?.card_id;
  if (!cardId) {
    throw new Error('CardKit 未返回 card_id');
  }

  // 2) 发送卡片消息
  const sendRes = (await client.im.v1.message.create({
    params: { receive_id_type: inferReceiveIdType(chatType) },
    data: {
      receive_id: resolveFeishuReceiveId(peerId, chatType),
      msg_type: 'interactive',
      content: JSON.stringify({ type: 'card', data: { card_id: cardId } }),
    },
  })) as GenericSdkResponse & { data?: { message_id?: string } };
  if (sendRes.code) {
    throw new FeishuApiError('发送流式卡片', sendRes.code, sendRes.msg ?? '');
  }
  const messageId = sendRes.data?.message_id ?? null;

  // 3) 返回 handle
  return createHandle(client, cardId, messageId, idleMs, placeholder, options.title);
}

function createHandle(
  client: Lark.Client,
  cardId: string,
  messageId: string | null,
  idleMs: number,
  placeholder: string,
  title?: string,
): StreamingCardHandle {
  let sequence = 1;
  let closed = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let lastText = placeholder;

  const armWatchdog = () => {
    if (idleMs <= 0) return;
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (closed) return;
      // setTimeout 回调无处抛错，只能记录日志
      void finalize('timeout').catch((err) => {
        log.warn(
          `流式卡超时 finalize 失败 cardId=${cardId}: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, idleMs);
    watchdog.unref?.();
  };

  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const append = async (fullText: string): Promise<void> => {
    if (closed) throw new Error('streaming card 已关闭');
    lastText = fullText;
    sequence += 1;
    const res = (await client.cardkit.v1.cardElement.content({
      path: { card_id: cardId, element_id: STREAMING_ELEMENT_ID },
      data: {
        content: fullText,
        sequence,
      },
    })) as GenericSdkResponse;
    if (res.code) {
      throw new FeishuApiError('更新流式内容', res.code, res.msg ?? '');
    }
    armWatchdog();
  };

  const finalize = async (
    mode: 'finish' | 'abort' | 'timeout',
    reason?: string,
  ): Promise<void> => {
    if (closed) return;
    closed = true;
    clearWatchdog();

    // 最终整卡 update：关闭 streaming_mode，固化最终内容
    const finalCard = buildFinalCard(lastText, mode, reason, title);
    sequence += 1;
    const res = (await client.cardkit.v1.card.update({
      path: { card_id: cardId },
      data: {
        card: { type: 'card_json', data: JSON.stringify(finalCard) },
        sequence,
      },
    })) as GenericSdkResponse;
    if (res.code) {
      throw new FeishuApiError('结束流式卡片', res.code, res.msg ?? '');
    }
  };

  armWatchdog();

  return {
    cardId,
    messageId,
    get closed() {
      return closed;
    },
    append,
    finish: () => finalize('finish'),
    abort: (reason?: string) => finalize('abort', reason),
  };
}

/** 构造结束态卡（关闭 streaming_mode） */
function buildFinalCard(
  content: string,
  mode: 'finish' | 'abort' | 'timeout',
  reason?: string,
  title?: string,
): Record<string, unknown> {
  const footer =
    mode === 'abort'
      ? `（已取消${reason ? `：${reason}` : ''}）`
      : mode === 'timeout'
      ? '（已超时）'
      : '';
  const body =
    footer && !content.includes(footer) ? `${content}\n\n${footer}` : content;

  const card: Record<string, unknown> = {
    schema: '2.0',
    config: {
      summary: { content: body.slice(0, 40) },
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          element_id: STREAMING_ELEMENT_ID,
          content: body,
        },
      ],
    },
  };
  if (title) {
    card['header'] = {
      title: { tag: 'plain_text', content: title },
    };
  }
  return card;
}
