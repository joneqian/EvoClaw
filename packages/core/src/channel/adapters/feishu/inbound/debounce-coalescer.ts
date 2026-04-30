/**
 * 飞书入站文本合并器（debounce coalescer）
 *
 * 用户连续发送多条短消息时（"你好" → 2s → "我想问一下" → 3s → "天气怎么样"），
 * 将连续消息合并成一条 deliver 给 handler，避免 N 次 agent 唤醒（"一句一回"）。
 *
 * 设计要点：
 * - 安静窗口 reset-on-msg + maxWait 硬上限（防止 30s 连发被一直憋着）
 * - 仅作用于"会唤醒 agent"的消息（群已 @bot 过滤后才进 handler 路径，所以本层
 *   不需要再判 @）
 * - **不合并**带 mediaPath / quoted / broadcastTargets 的消息——这些消息有独立
 *   语义，合并会丢字段：
 *   - mediaPath: ChannelMessage 单字段无法表达多媒体
 *   - quoted: 引用回复通常是"重新对焦"，不是 burst 的延续
 *   - broadcastTargets: fanout 目标列表合并语义不清
 * - sessionKey = peerId（已被 inbound 阶段按 group session scope 重写）
 * - 不持久化：sidecar 重启 buffer 丢失（v1 接受，见 plan Out of Scope）
 */

import type { ChannelMessage } from '@evoclaw/shared';
import type { MessageHandler } from '../../../channel-adapter.js';
import { createLogger } from '../../../../infrastructure/logger.js';

const log = createLogger('feishu-debounce');

export interface DebounceConfig {
  /** 是否启用合并器（关闭时 enqueue 直接 deliver） */
  enabled: boolean;
  /** 安静窗口 ms：本窗口内无新消息则 flush，每条新消息 reset 该窗口 */
  quietWindowMs: number;
  /** 单 session 最大累积 ms 硬上限：防止 30s 连发一直被憋着 */
  maxWaitMs: number;
}

export const DEFAULT_DEBOUNCE_CONFIG: DebounceConfig = {
  enabled: true,
  quietWindowMs: 4000,
  maxWaitMs: 30_000,
};

interface BufferEntry {
  messages: ChannelMessage[];
  quietTimer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  startTs: number;
}

/**
 * 入站消息合并器
 *
 * 用法：每个 FeishuAdapter 实例持有一个；inbound flow 在调 handler 前替换为
 * `await coalescer.enqueue(msg)`。
 */
export class DebounceCoalescer {
  private readonly buffers = new Map<string, BufferEntry>();

  constructor(
    private readonly config: DebounceConfig,
    private readonly handler: MessageHandler,
  ) {}

  /**
   * 接收一条入站消息
   *
   * - 不合并的消息（media/quoted/broadcast）：先 flush 当前 session buffer，
   *   再独立 deliver
   * - 普通文本：累积到 buffer，重置安静窗口
   *
   * 不返回 Promise——deliver 是 fire-and-forget（与原 inbound `Promise.resolve(handler(...))`
   * 语义一致），错误在 deliver 内部 catch + log
   */
  enqueue(msg: ChannelMessage): void {
    if (!this.config.enabled) {
      void this.deliver(msg);
      return;
    }

    if (this.shouldBypass(msg)) {
      this.flushKey(msg.peerId);
      void this.deliver(msg);
      return;
    }

    const key = msg.peerId;
    let entry = this.buffers.get(key);
    if (!entry) {
      entry = {
        messages: [],
        quietTimer: null,
        maxTimer: null,
        startTs: Date.now(),
      };
      this.buffers.set(key, entry);
      // 首条进 buffer 时启动 maxWait 硬上限
      entry.maxTimer = setTimeout(() => {
        log.info(`[${key}] maxWait=${this.config.maxWaitMs}ms 触发硬 flush`);
        this.flushKey(key);
      }, this.config.maxWaitMs);
    }
    entry.messages.push(msg);

    // 每条新消息重置安静窗口
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
    entry.quietTimer = setTimeout(() => {
      log.debug(`[${key}] 安静窗口=${this.config.quietWindowMs}ms 触发 flush`);
      this.flushKey(key);
    }, this.config.quietWindowMs);
  }

  /**
   * 立即 flush 指定 session 的 buffer
   *
   * 公开供 adapter shutdown / 单测使用
   */
  flushKey(key: string): void {
    const entry = this.buffers.get(key);
    if (!entry || entry.messages.length === 0) {
      this.buffers.delete(key);
      return;
    }
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
    if (entry.maxTimer) clearTimeout(entry.maxTimer);
    this.buffers.delete(key);

    const merged =
      entry.messages.length === 1
        ? entry.messages[0]!
        : this.mergeMessages(entry.messages);
    void this.deliver(merged);
  }

  /**
   * 关闭：flush 所有 session buffer
   *
   * adapter.disconnect() 时调用，避免内存中数据丢失（虽然进程都要退出了）
   */
  shutdown(): void {
    for (const key of [...this.buffers.keys()]) {
      this.flushKey(key);
    }
  }

  /** 测试便利：返回当前 buffer 中等待 flush 的 session 数 */
  get pendingSessionCount(): number {
    return this.buffers.size;
  }

  /** 应跳过合并的消息（media / 引用 / 广播 fanout） */
  private shouldBypass(msg: ChannelMessage): boolean {
    if (msg.mediaPath) return true;
    if (msg.quoted) return true;
    if (msg.broadcastTargets && msg.broadcastTargets.length > 0) return true;
    return false;
  }

  /**
   * 合并 N 条文本消息为单条
   *
   * 策略：content 用 `\n` 拼接，其它字段用最后一条（messageId/timestamp/senderId）。
   * 失去的信息：早期消息的 messageId（agent 不需要、平台引用不到）。
   */
  private mergeMessages(msgs: ChannelMessage[]): ChannelMessage {
    const last = msgs[msgs.length - 1]!;
    return {
      ...last,
      content: msgs.map((m) => m.content).join('\n'),
    };
  }

  private async deliver(msg: ChannelMessage): Promise<void> {
    try {
      await this.handler(msg);
    } catch (err) {
      log.error(
        `deliver 失败 messageId=${msg.messageId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
