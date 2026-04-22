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

/** 多账号索引 key（内部用） */
type AccountKey = string;

/**
 * Adapter 工厂函数 —— 按需创建某 ChannelType 下的 adapter 实例
 *
 * 用途：支持"一个 ChannelType 多账号"时，每个账号需要独立 adapter 实例，
 * 启动时尚未知道账号列表，改由 ChannelManager 在 connect(accountId) 时通过
 * factory lazy create。
 */
export type AdapterFactory = () => ChannelAdapter;

/**
 * Channel 管理器 — Channel 生命周期管理
 *
 * 支持同 ChannelType 多账号共存：
 * - 每个 (channel, accountId) 对应一个独立 ChannelAdapter 实例 + 独立 WS 连接
 * - 启动时 server.ts 调用 `registerFactory(type, factory)` 注册 adapter 工厂
 * - `connect({ type, accountId, ... })` 时若对应实例不存在则用 factory 创建
 * - `disconnect(type, accountId)` 精准断开单个账号，不影响同 type 的其他账号
 */
export class ChannelManager {
  private adapters = new Map<ChannelType, Map<AccountKey, ChannelAdapter>>();
  private factories = new Map<ChannelType, AdapterFactory>();
  private configs = new Map<ChannelType, Map<AccountKey, ChannelConfig>>();
  private reconnectTimers = new Map<string /* `${type}:${accountId}` */, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();
  private messageHandler: MessageHandler | null = null;

  /** 归一化 accountId（过渡期默认 ''） */
  private norm(accountId?: string): string {
    return accountId ?? '';
  }

  /** reconnect timer / attempts 用的复合 key */
  private timerKey(type: ChannelType, accountId: string): string {
    return `${type}:${accountId}`;
  }

  /**
   * 注册 Channel adapter 工厂
   *
   * 启动时调用一次；同 type 重复注册会覆盖。adapter 实例按 connect(accountId)
   * 按需创建（lazy）。
   */
  registerFactory(type: ChannelType, factory: AdapterFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * 直接注册已创建的 adapter 实例（兼容老路径）
   *
   * 用于 local / weixin 这类"单账号就够了"的渠道，直接 new 一个实例当默认账号
   * （accountId=''）注册进来。飞书走 registerFactory。
   */
  registerAdapter(adapter: ChannelAdapter, accountId: string = ''): void {
    let slot = this.adapters.get(adapter.type);
    if (!slot) {
      slot = new Map();
      this.adapters.set(adapter.type, slot);
    }
    slot.set(accountId, adapter);
    if (this.messageHandler) {
      adapter.onMessage(this.messageHandler);
    }
  }

  /** 注销某 channel 下某账号的 adapter */
  unregisterAdapter(type: ChannelType, accountId: string = ''): void {
    const slot = this.adapters.get(type);
    const adapter = slot?.get(accountId);
    if (adapter) {
      adapter.disconnect().catch(() => {});
      slot!.delete(accountId);
      if (slot!.size === 0) this.adapters.delete(type);
      this.configs.get(type)?.delete(accountId);
      this.clearReconnectTimer(type, accountId);
    }
  }

  /** 设置全局消息回调（对所有已注册 + 后续注册的 adapter 生效） */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
    for (const slot of this.adapters.values()) {
      for (const adapter of slot.values()) {
        adapter.onMessage(handler);
      }
    }
  }

  /**
   * 连接指定 Channel 的某个账号
   *
   * 若该账号还没有 adapter 实例，用 `factories.get(type)` 工厂创建。
   * 同 ChannelType 内多次调用不同 accountId → 独立 adapter 互不影响。
   */
  async connect(config: ChannelConfig): Promise<void> {
    const accountId = this.norm(config.accountId);
    let adapter = this.getAdapter(config.type, accountId);

    if (!adapter) {
      const factory = this.factories.get(config.type);
      if (!factory) {
        const registeredFactories = Array.from(this.factories.keys()).join(', ') || '无';
        const registeredAdapters = Array.from(this.adapters.keys()).join(', ') || '无';
        throw new Error(
          `未注册 ${config.type} Channel 适配器（当前构建可能未启用该渠道）。` +
            `已注册 factory：${registeredFactories}；已注册实例：${registeredAdapters}`,
        );
      }
      adapter = factory();
      this.registerAdapter(adapter, accountId);
    }

    let configSlot = this.configs.get(config.type);
    if (!configSlot) {
      configSlot = new Map();
      this.configs.set(config.type, configSlot);
    }
    configSlot.set(accountId, config);
    this.reconnectAttempts.set(this.timerKey(config.type, accountId), 0);

    try {
      await adapter.connect(config);
    } catch (err) {
      log.error(`${config.type}[${accountId || '(default)'}] 连接失败:`, err);
      this.scheduleReconnect(config.type, accountId);
      throw err;
    }
  }

  /** 断开指定 Channel 的某个账号 */
  async disconnect(type: ChannelType, accountId: string = ''): Promise<void> {
    const adapter = this.getAdapter(type, accountId);
    if (adapter) {
      this.clearReconnectTimer(type, accountId);
      this.reconnectAttempts.delete(this.timerKey(type, accountId));
      await adapter.disconnect();
    }
  }

  /** 发送消息 —— 必须指定 accountId（过渡期默认 '' 用第一个账号） */
  async sendMessage(
    channel: ChannelType,
    accountIdOrPeerId: string,
    peerIdOrContent: string,
    contentOrChatType?: string | ('private' | 'group'),
    chatType?: 'private' | 'group',
  ): Promise<void> {
    // 签名兼容：老调用 sendMessage(channel, peerId, content, chatType?)
    // 新调用 sendMessage(channel, accountId, peerId, content, chatType?)
    // 通过参数个数判断（老调用 chatType 要么没有要么在第 3 位）
    let accountId: string;
    let peerId: string;
    let content: string;
    let ct: 'private' | 'group' | undefined;

    if (typeof contentOrChatType === 'string' && contentOrChatType !== 'private' && contentOrChatType !== 'group') {
      // 新签名：(channel, accountId, peerId, content, chatType?)
      accountId = accountIdOrPeerId;
      peerId = peerIdOrContent;
      content = contentOrChatType;
      ct = chatType;
    } else {
      // 老签名：(channel, peerId, content, chatType?)
      accountId = '';
      peerId = accountIdOrPeerId;
      content = peerIdOrContent;
      ct = (contentOrChatType as 'private' | 'group' | undefined) ?? chatType;
    }

    const adapter = this.resolveAdapter(channel, accountId);
    if (adapter.getStatus().status !== 'connected') {
      throw new Error(`Channel ${channel}[${accountId || '(default)'}] 未连接`);
    }
    await adapter.sendMessage(peerId, content, ct);
  }

  /** 发送媒体消息（签名兼容同 sendMessage） */
  async sendMediaMessage(
    channel: ChannelType,
    accountIdOrPeerId: string,
    peerIdOrFilePath: string,
    filePathOrText?: string,
    textOrChatType?: string | ('private' | 'group'),
    chatType?: 'private' | 'group',
  ): Promise<void> {
    let accountId: string;
    let peerId: string;
    let filePath: string;
    let text: string | undefined;
    let ct: 'private' | 'group' | undefined;

    if (textOrChatType !== undefined && textOrChatType !== 'private' && textOrChatType !== 'group') {
      // 新签名：(channel, accountId, peerId, filePath, text?, chatType?)
      accountId = accountIdOrPeerId;
      peerId = peerIdOrFilePath;
      filePath = filePathOrText ?? '';
      text = textOrChatType;
      ct = chatType;
    } else {
      // 老签名：(channel, peerId, filePath, text?, chatType?)
      accountId = '';
      peerId = accountIdOrPeerId;
      filePath = peerIdOrFilePath;
      text = filePathOrText;
      ct = textOrChatType as 'private' | 'group' | undefined;
    }

    const adapter = this.resolveAdapter(channel, accountId);
    if (adapter.getStatus().status !== 'connected') {
      throw new Error(`Channel ${channel}[${accountId || '(default)'}] 未连接`);
    }
    if (!adapter.sendMediaMessage) {
      throw new Error(`Channel ${channel} 不支持媒体发送`);
    }
    await adapter.sendMediaMessage(peerId, filePath, text, ct);
  }

  /**
   * 按 (channel, accountId) 精确查找 adapter
   *
   * accountId='' 时有 fallback：先按 '' 查；查不到取该 channel 下**第一个**账号
   * （向后兼容老代码 "channel 级唯一 adapter" 的语义；有多账号且不指定时语义模糊，
   * 调用方应尽量传 accountId）。
   */
  getAdapter(type: ChannelType, accountId: string = ''): ChannelAdapter | undefined {
    const slot = this.adapters.get(type);
    if (!slot) return undefined;
    const exact = slot.get(accountId);
    if (exact) return exact;
    if (accountId === '' && slot.size > 0) {
      return slot.values().next().value;
    }
    return undefined;
  }

  /** 内部：resolve adapter，找不到抛错（sendMessage 等操作用） */
  private resolveAdapter(type: ChannelType, accountId: string): ChannelAdapter {
    const adapter = this.getAdapter(type, accountId);
    if (!adapter) {
      throw new Error(`Channel ${type}[${accountId || '(default)'}] 未注册`);
    }
    return adapter;
  }

  /** 获取所有 Channel × Account 状态（展平，每 (type, accountId) 一条） */
  getStatuses(): ChannelStatusInfo[] {
    const result: ChannelStatusInfo[] = [];
    for (const [type, slot] of this.adapters.entries()) {
      for (const [accountId, adapter] of slot.entries()) {
        const status = adapter.getStatus();
        result.push({
          ...status,
          type,
          accountId,
        });
      }
    }
    return result;
  }

  /** 获取单个 Channel 的状态（多账号时返回第一个；多账号请用 getStatuses） */
  getStatus(type: ChannelType, accountId: string = ''): ChannelStatusInfo | undefined {
    const adapter = this.getAdapter(type, accountId);
    if (!adapter) return undefined;
    return { ...adapter.getStatus(), type, accountId };
  }

  /** 获取已注册的 Channel 类型列表（去重） */
  getRegisteredTypes(): ChannelType[] {
    return Array.from(this.adapters.keys());
  }

  /** 列出某 ChannelType 下所有已注册 accountId */
  listAccounts(type: ChannelType): string[] {
    const slot = this.adapters.get(type);
    return slot ? Array.from(slot.keys()) : [];
  }

  /** 全部断开 */
  async disconnectAll(): Promise<void> {
    for (const [type, slot] of this.adapters.entries()) {
      for (const accountId of Array.from(slot.keys())) {
        await this.disconnect(type, accountId).catch(() => {});
      }
    }
  }

  /** 调度重连（按 (type, accountId) 隔离） */
  private scheduleReconnect(type: ChannelType, accountId: string): void {
    const key = this.timerKey(type, accountId);
    const attempts = this.reconnectAttempts.get(key) ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error(`${type}[${accountId || '(default)'}] 重连次数已达上限 (${MAX_RECONNECT_ATTEMPTS})`);
      return;
    }

    this.clearReconnectTimer(type, accountId);
    const delay = RECONNECT_DELAY_MS * Math.pow(1.5, attempts);

    const timer = setTimeout(async () => {
      this.reconnectAttempts.set(key, attempts + 1);
      const config = this.configs.get(type)?.get(accountId);
      if (!config) return;

      log.info(`${type}[${accountId || '(default)'}] 尝试重连 (${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
      try {
        const adapter = this.getAdapter(type, accountId);
        if (adapter) {
          await adapter.connect(config);
          this.reconnectAttempts.set(key, 0);
          log.info(`${type}[${accountId || '(default)'}] 重连成功`);
        }
      } catch {
        this.scheduleReconnect(type, accountId);
      }
    }, delay);

    this.reconnectTimers.set(key, timer);
  }

  /** 清除重连定时器 */
  private clearReconnectTimer(type: ChannelType, accountId: string): void {
    const key = this.timerKey(type, accountId);
    const timer = this.reconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(key);
    }
  }
}
