import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelStatusInfo,
  MessageHandler,
} from '../channel-adapter.js';

/**
 * 桌面 Channel 适配器
 *
 * 桌面应用内默认 Channel：
 * - 直接通过 Hono HTTP 通信（Chat 路由已有）
 * - 始终处于 connected 状态
 * - sendMessage 仅记录日志（桌面 UI 从 SSE 流获取响应）
 */
export class DesktopAdapter implements ChannelAdapter {
  readonly type = 'local' as const;

  private handler: MessageHandler | null = null;
  private status: ChannelStatusInfo = {
    type: 'local',
    name: '桌面',
    status: 'disconnected',
  };

  async connect(_config: ChannelConfig): Promise<void> {
    this.status = {
      type: 'local',
      name: '桌面',
      status: 'connected',
      connectedAt: new Date().toISOString(),
    };
  }

  async disconnect(): Promise<void> {
    this.status = { ...this.status, status: 'disconnected' };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * 处理来自 Chat 路由的消息
   * 桌面 Channel 的消息由 Chat 路由直接处理，
   * 此方法用于统一流程（如需要经过 BindingRouter）
   */
  async handleIncomingMessage(content: string, userId: string = 'local-user'): Promise<void> {
    if (!this.handler) return;

    const { normalizeDesktopMessage } = await import('../message-normalizer.js');
    const message = normalizeDesktopMessage(content, userId);
    await this.handler(message);
  }

  async sendMessage(_peerId: string, _content: string): Promise<void> {
    // 桌面 Channel 不需要主动发送 — UI 从 SSE 流获取响应
    // 此处为接口兼容，无操作
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }
}
