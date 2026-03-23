import type { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelType } from '@evoclaw/shared';

/** Channel 工具定义 */
export interface ChannelTool {
  name: string;
  description: string;
  channel: ChannelType;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

/**
 * 创建 Channel 专属工具
 * 按当前通道动态注入（仅注入当前 Channel 的工具）
 */
export function createChannelTools(
  channelManager: ChannelManager,
  currentChannel: ChannelType,
): ChannelTool[] {
  const tools: ChannelTool[] = [];

  // 桌面通知工具（始终可用）
  tools.push({
    name: 'desktop_notify',
    description: '发送桌面通知',
    channel: 'local',
    execute: async (params) => {
      const title = (params['title'] as string) ?? 'EvoClaw';
      const body = (params['body'] as string) ?? '';
      // 桌面通知由前端 Tauri 处理，此处返回成功标记
      return JSON.stringify({ sent: true, title, body });
    },
  });

  // 飞书工具
  if (currentChannel === 'feishu') {
    tools.push({
      name: 'feishu_send',
      description: '通过飞书发送文本消息',
      channel: 'feishu',
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const content = params['content'] as string;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !content) return '错误：缺少 peerId 或 content';
        await channelManager.sendMessage('feishu', peerId, content, chatType);
        return `已发送到飞书 ${peerId}`;
      },
    });

    tools.push({
      name: 'feishu_card',
      description: '通过飞书发送卡片消息（JSON 格式）',
      channel: 'feishu',
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const card = params['card'] as string;
        if (!peerId || !card) return '错误：缺少 peerId 或 card';
        // 卡片消息通过 sendMessage 发送 JSON
        await channelManager.sendMessage('feishu', peerId, card);
        return `已发送飞书卡片到 ${peerId}`;
      },
    });
  }

  // 企微工具
  if (currentChannel === 'wecom') {
    tools.push({
      name: 'wecom_send',
      description: '通过企业微信发送文本消息',
      channel: 'wecom',
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const content = params['content'] as string;
        if (!peerId || !content) return '错误：缺少 peerId 或 content';
        await channelManager.sendMessage('wecom', peerId, content);
        return `已发送到企微 ${peerId}`;
      },
    });
  }

  // 微信工具
  if (currentChannel === 'weixin') {
    tools.push({
      name: 'weixin_send',
      description: '通过微信发送文本消息',
      channel: 'weixin',
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const content = params['content'] as string;
        if (!peerId || !content) return '错误：缺少 peerId 或 content';
        await channelManager.sendMessage('weixin', peerId, content);
        return `已发送到微信 ${peerId}`;
      },
    });

    tools.push({
      name: 'weixin_send_media',
      description: '通过微信发送媒体文件（图片/视频/文件），支持本地路径或远程 URL',
      channel: 'weixin',
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const filePath = params['filePath'] as string;
        const text = params['text'] as string | undefined;
        if (!peerId || !filePath) return '错误：缺少 peerId 或 filePath';
        await channelManager.sendMediaMessage('weixin', peerId, filePath, text);
        return `已发送媒体文件到微信 ${peerId}: ${filePath}`;
      },
    });
  }

  return tools;
}

/**
 * 获取指定 Channel 的工具名列表（用于 tool-registry 注入）
 */
export function getChannelToolNames(channel: ChannelType): string[] {
  const base = ['desktop_notify'];
  switch (channel) {
    case 'feishu':
      return [...base, 'feishu_send', 'feishu_card'];
    case 'wecom':
      return [...base, 'wecom_send'];
    case 'weixin':
      return [...base, 'weixin_send', 'weixin_send_media'];
    default:
      return base;
  }
}
