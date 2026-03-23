import type { ChannelType } from '@evoclaw/shared';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelStatusInfo,
  MessageHandler,
} from './channel-adapter.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('channel-manager');

/** 重连配置 */
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Channel 管理器 — Channel 生命周期管理
 * 注册/注销适配器，连接状态监控，自动重连
 */
export class ChannelManager {
  private adapters = new Map<ChannelType, ChannelAdapter>();
  private configs = new Map<ChannelType, ChannelConfig>();
  private reconnectTimers = new Map<ChannelType, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<ChannelType, number>();
  private messageHandler: MessageHandler | null = null;

  /** 注册 Channel 适配器 */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
    // 如果已有全局消息回调，自动注册
    if (this.messageHandler) {
      adapter.onMessage(this.messageHandler);
    }
  }

  /** 注销 Channel 适配器 */
  unregisterAdapter(type: ChannelType): void {
    const adapter = this.adapters.get(type);
    if (adapter) {
      adapter.disconnect().catch(() => {});
      this.adapters.delete(type);
      this.configs.delete(type);
      this.clearReconnectTimer(type);
    }
  }

  /** 设置全局消息回调 */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
    // 注册到所有已有的适配器
    for (const adapter of this.adapters.values()) {
      adapter.onMessage(handler);
    }
  }

  /** 连接指定 Channel */
  async connect(config: ChannelConfig): Promise<void> {
    const adapter = this.adapters.get(config.type);
    if (!adapter) {
      throw new Error(`未注册 ${config.type} Channel 适配器`);
    }

    this.configs.set(config.type, config);
    this.reconnectAttempts.set(config.type, 0);

    try {
      await adapter.connect(config);
    } catch (err) {
      log.error(`${config.type} 连接失败:`, err);
      this.scheduleReconnect(config.type);
      throw err;
    }
  }

  /** 断开指定 Channel */
  async disconnect(type: ChannelType): Promise<void> {
    const adapter = this.adapters.get(type);
    if (adapter) {
      this.clearReconnectTimer(type);
      this.reconnectAttempts.delete(type);
      await adapter.disconnect();
    }
  }

  /** 发送消息 */
  async sendMessage(
    channel: ChannelType,
    peerId: string,
    content: string,
    chatType?: 'private' | 'group',
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`Channel ${channel} 未注册`);
    }
    if (adapter.getStatus().status !== 'connected') {
      throw new Error(`Channel ${channel} 未连接`);
    }
    await adapter.sendMessage(peerId, content, chatType);
  }

  /** 发送媒体消息 */
  async sendMediaMessage(
    channel: ChannelType,
    peerId: string,
    filePath: string,
    text?: string,
    chatType?: 'private' | 'group',
  ): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`Channel ${channel} 未注册`);
    }
    if (adapter.getStatus().status !== 'connected') {
      throw new Error(`Channel ${channel} 未连接`);
    }
    if (!adapter.sendMediaMessage) {
      throw new Error(`Channel ${channel} 不支持媒体发送`);
    }
    await adapter.sendMediaMessage(peerId, filePath, text, chatType);
  }

  /** 获取适配器实例 */
  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  /** 获取所有 Channel 状态 */
  getStatuses(): ChannelStatusInfo[] {
    return Array.from(this.adapters.values()).map((a) => a.getStatus());
  }

  /** 获取单个 Channel 状态 */
  getStatus(type: ChannelType): ChannelStatusInfo | undefined {
    return this.adapters.get(type)?.getStatus();
  }

  /** 获取已注册的 Channel 类型 */
  getRegisteredTypes(): ChannelType[] {
    return Array.from(this.adapters.keys());
  }

  /** 全部断开 */
  async disconnectAll(): Promise<void> {
    for (const type of this.adapters.keys()) {
      await this.disconnect(type).catch(() => {});
    }
  }

  /** 调度重连 */
  private scheduleReconnect(type: ChannelType): void {
    const attempts = this.reconnectAttempts.get(type) ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(`${type} 重连次数已达上限 (${MAX_RECONNECT_ATTEMPTS})`);
      return;
    }

    this.clearReconnectTimer(type);
    const delay = RECONNECT_DELAY_MS * Math.pow(1.5, attempts); // 指数退避

    const timer = setTimeout(async () => {
      this.reconnectAttempts.set(type, attempts + 1);
      const config = this.configs.get(type);
      if (!config) return;

      log.info(`${type} 尝试重连 (${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
      try {
        const adapter = this.adapters.get(type);
        if (adapter) {
          await adapter.connect(config);
          this.reconnectAttempts.set(type, 0);
          log.info(`${type} 重连成功`);
        }
      } catch {
        this.scheduleReconnect(type);
      }
    }, delay);

    this.reconnectTimers.set(type, timer);
  }

  /** 清除重连定时器 */
  private clearReconnectTimer(type: ChannelType): void {
    const timer = this.reconnectTimers.get(type);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(type);
    }
  }
}
