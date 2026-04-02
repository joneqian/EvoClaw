/**
 * Agent 间消息通信总线
 *
 * 参考 Claude Code SendMessageTool:
 * - Agent 间发送/接收类型化消息
 * - 支持定向发送和广播
 * - 结构化消息类型（shutdown_request 等）
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('agent-bus');

/** 消息类型 */
export type AgentMessageType =
  | 'text'                  // 普通文本消息
  | 'shutdown_request'      // 请求关闭
  | 'shutdown_response'     // 确认关闭
  | 'status_update'         // 状态更新
  | 'data_share';           // 数据共享

/** Agent 间消息 */
export interface AgentMessage {
  id: string;
  from: string;       // 发送者 taskId
  to: string;         // 接收者 taskId（'*' = 广播）
  type: AgentMessageType;
  content: string;
  timestamp: number;
}

/** 消息回调 */
export type MessageHandler = (message: AgentMessage) => void;

/**
 * Agent 消息总线 — 进程内消息路由
 *
 * 每个 SubAgentSpawner 实例共享同一个 bus（通过构造函数注入）。
 */
export class AgentMessageBus {
  private handlers = new Map<string, MessageHandler[]>();
  private messageQueue = new Map<string, AgentMessage[]>();

  /** 注册消息接收者 */
  subscribe(agentTaskId: string, handler: MessageHandler): void {
    const existing = this.handlers.get(agentTaskId) ?? [];
    existing.push(handler);
    this.handlers.set(agentTaskId, existing);

    // 投递积压的消息
    const queued = this.messageQueue.get(agentTaskId);
    if (queued && queued.length > 0) {
      for (const msg of queued) {
        handler(msg);
      }
      this.messageQueue.delete(agentTaskId);
    }
  }

  /** 注销接收者 */
  unsubscribe(agentTaskId: string): void {
    this.handlers.delete(agentTaskId);
    this.messageQueue.delete(agentTaskId);
  }

  /** 发送消息（定向或广播） */
  send(message: AgentMessage): void {
    log.info(`消息: ${message.from} → ${message.to} [${message.type}] ${message.content.slice(0, 50)}`);

    if (message.to === '*') {
      // 广播给所有订阅者（除发送者自己）
      for (const [taskId, handlers] of this.handlers) {
        if (taskId === message.from) continue;
        for (const handler of handlers) {
          handler(message);
        }
      }
    } else {
      // 定向发送
      const handlers = this.handlers.get(message.to);
      if (handlers) {
        for (const handler of handlers) {
          handler(message);
        }
      } else {
        // 接收者尚未注册 → 入队等待
        const queue = this.messageQueue.get(message.to) ?? [];
        queue.push(message);
        this.messageQueue.set(message.to, queue);
      }
    }
  }

  /** 发送关闭请求 */
  sendShutdownRequest(from: string, to: string, reason?: string): void {
    this.send({
      id: crypto.randomUUID(),
      from,
      to,
      type: 'shutdown_request',
      content: reason ?? '请完成当前操作后关闭',
      timestamp: Date.now(),
    });
  }

  /** 发送关闭确认 */
  sendShutdownResponse(from: string, to: string): void {
    this.send({
      id: crypto.randomUUID(),
      from,
      to,
      type: 'shutdown_response',
      content: '已准备关闭',
      timestamp: Date.now(),
    });
  }

  /** 清理所有状态 */
  clear(): void {
    this.handlers.clear();
    this.messageQueue.clear();
  }
}
