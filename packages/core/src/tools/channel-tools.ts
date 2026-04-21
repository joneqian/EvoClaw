/**
 * Channel 专属工具定义
 *
 * 为 Agent 暴露渠道能力。每个工具自带 JSON schema 参数描述，
 * 由 `channel-message-handler` 统一注入 peerId（无需 agent 填写）。
 */

import type { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelType } from '@evoclaw/shared';
import type { FeishuAdapter } from '../channel/adapters/feishu/index.js';

/** JSON Schema 子集（只用到的字段） */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }>;
  required?: string[];
}

/** Channel 工具定义 */
export interface ChannelTool {
  name: string;
  description: string;
  channel: ChannelType;
  parameters: ToolParameters;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

function requireFeishuAdapter(channelManager: ChannelManager): FeishuAdapter {
  const adapter = channelManager.getAdapter('feishu') as FeishuAdapter | undefined;
  if (!adapter) throw new Error('飞书 Channel 未注册');
  return adapter;
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

  // 桌面通知工具（始终可用，非渠道模式）
  tools.push({
    name: 'desktop_notify',
    description: '发送桌面通知',
    channel: 'local',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '通知标题' },
        body: { type: 'string', description: '通知正文' },
      },
    },
    execute: async (params) => {
      const title = (params['title'] as string) ?? 'EvoClaw';
      const body = (params['body'] as string) ?? '';
      return JSON.stringify({ sent: true, title, body });
    },
  });

  // ─── 飞书工具集 ─────────────────────────────────────────────────────
  if (currentChannel === 'feishu') {
    tools.push({
      name: 'feishu_send',
      description: '通过飞书发送文本 / Markdown 消息（Markdown 自动渲染为飞书 Post 富文本）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '消息内容（支持 Markdown）' },
        },
        required: ['content'],
      },
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
      description: '通过飞书发送 interactive 卡片消息（需提供完整卡片 JSON 字符串）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          card: { type: 'string', description: '飞书 interactive 卡片 JSON 字符串' },
        },
        required: ['card'],
      },
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const card = params['card'] as string;
        if (!peerId || !card) return '错误：缺少 peerId 或 card';
        await channelManager.sendMessage('feishu', peerId, card);
        return `已发送飞书卡片到 ${peerId}`;
      },
    });

    tools.push({
      name: 'feishu_send_image',
      description: '通过飞书发送本地图片（飞书官方上限 10MB，超限会拒绝）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '图片本地绝对路径（jpg/png/gif/webp/bmp 等）' },
          caption: { type: 'string', description: '可选的图片说明文字' },
        },
        required: ['filePath'],
      },
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const filePath = params['filePath'] as string;
        const caption = params['caption'] as string | undefined;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !filePath) return '错误：缺少 peerId 或 filePath';
        await channelManager.sendMediaMessage('feishu', peerId, filePath, caption, chatType);
        return `已发送图片到飞书 ${peerId}: ${filePath}`;
      },
    });

    tools.push({
      name: 'feishu_send_file',
      description: '通过飞书发送本地文件（文档/音频/视频，官方上限 30MB）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '文件本地绝对路径' },
          caption: { type: 'string', description: '可选的文件说明文字' },
        },
        required: ['filePath'],
      },
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const filePath = params['filePath'] as string;
        const caption = params['caption'] as string | undefined;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !filePath) return '错误：缺少 peerId 或 filePath';
        // 复用同一 sendMediaMessage 管道：内部按扩展名分 image/file 路径
        await channelManager.sendMediaMessage('feishu', peerId, filePath, caption, chatType);
        return `已发送文件到飞书 ${peerId}: ${filePath}`;
      },
    });

    tools.push({
      name: 'feishu_request_approval',
      description:
        '向用户发送审批卡片并等待用户点击"批准/拒绝"；用于危险操作的人类审核。' +
        '默认 TTL 24 小时，返回 decision=approve|deny|timeout',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '卡片标题' },
          body: { type: 'string', description: '卡片正文（Markdown）' },
          sessionKey: { type: 'string', description: '关联的会话 key，用于校验点击者会话一致' },
          ttlMs: { type: 'number', description: 'TTL 毫秒数（默认 24 小时）' },
          operatorOpenId: { type: 'string', description: '限定的操作者 open_id（可选）' },
        },
        required: ['title', 'body', 'sessionKey'],
      },
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const title = params['title'] as string;
        const body = params['body'] as string;
        const sessionKey = params['sessionKey'] as string;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !title || !body || !sessionKey) {
          return '错误：缺少 peerId / title / body / sessionKey';
        }
        const adapter = requireFeishuAdapter(channelManager);
        const options: {
          title: string;
          body: string;
          sessionKey: string;
          ttlMs?: number;
          operatorOpenId?: string;
        } = { title, body, sessionKey };
        if (typeof params['ttlMs'] === 'number') options.ttlMs = params['ttlMs'] as number;
        if (typeof params['operatorOpenId'] === 'string') {
          options.operatorOpenId = params['operatorOpenId'] as string;
        }
        const result = await adapter.requestApproval(peerId, options, chatType);
        return JSON.stringify(result);
      },
    });

    tools.push({
      name: 'feishu_reply_comment',
      description: '对飞书文档的已有评论追加回复（用于 drive.notice.comment_add_v1 触发后的 agent 协作）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: '文档唯一标识（从 drive 事件获得）' },
          commentId: { type: 'string', description: '要回复的评论 id' },
          fileType: {
            type: 'string',
            description: '文档类型',
            enum: ['doc', 'docx', 'sheet', 'file', 'slides'],
          },
          text: { type: 'string', description: '回复正文（纯文本）' },
        },
        required: ['fileToken', 'commentId', 'fileType', 'text'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const commentId = params['commentId'] as string;
        const fileType = params['fileType'] as DocFileTypeParam;
        const text = params['text'] as string;
        if (!fileToken || !commentId || !fileType || !text) {
          return '错误：缺少 fileToken / commentId / fileType / text';
        }
        const adapter = requireFeishuAdapter(channelManager);
        const replyId = await adapter.replyToComment({ fileToken, commentId, fileType, text });
        return JSON.stringify({ reply_id: replyId });
      },
    });

    tools.push({
      name: 'feishu_add_whole_comment',
      description: '对飞书文档追加一条全文评论（不附着在某块上）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: '文档唯一标识' },
          fileType: {
            type: 'string',
            description: '文档类型（仅 doc/docx 支持全文评论）',
            enum: ['doc', 'docx'],
          },
          text: { type: 'string', description: '评论正文（纯文本）' },
        },
        required: ['fileToken', 'fileType', 'text'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const fileType = params['fileType'] as 'doc' | 'docx';
        const text = params['text'] as string;
        if (!fileToken || !fileType || !text) {
          return '错误：缺少 fileToken / fileType / text';
        }
        const adapter = requireFeishuAdapter(channelManager);
        const commentId = await adapter.addWholeCommentReply({ fileToken, fileType, text });
        return JSON.stringify({ comment_id: commentId });
      },
    });

    tools.push({
      name: 'feishu_list_comment_replies',
      description: '列出飞书文档某条评论下的所有回复（用于 agent 看评论 timeline）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: '文档唯一标识' },
          commentId: { type: 'string', description: '评论 id' },
          fileType: {
            type: 'string',
            description: '文档类型',
            enum: ['doc', 'docx', 'sheet', 'file', 'slides'],
          },
          pageSize: { type: 'number', description: '单页条数（默认 20）' },
        },
        required: ['fileToken', 'commentId', 'fileType'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const commentId = params['commentId'] as string;
        const fileType = params['fileType'] as DocFileTypeParam;
        const pageSize = params['pageSize'] as number | undefined;
        if (!fileToken || !commentId || !fileType) {
          return '错误：缺少 fileToken / commentId / fileType';
        }
        const adapter = requireFeishuAdapter(channelManager);
        const listParams: {
          fileToken: string;
          commentId: string;
          fileType: DocFileTypeParam;
          pageSize?: number;
        } = { fileToken, commentId, fileType };
        if (typeof pageSize === 'number') listParams.pageSize = pageSize;
        const result = await adapter.listCommentReplies(listParams);
        return JSON.stringify(result);
      },
    });
  }

  // ─── 企微工具 ──────────────────────────────────────────────────────
  if (currentChannel === 'wecom') {
    tools.push({
      name: 'wecom_send',
      description: '通过企业微信发送文本消息',
      channel: 'wecom',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '消息内容' },
        },
        required: ['content'],
      },
      execute: async (params) => {
        const peerId = params['peerId'] as string;
        const content = params['content'] as string;
        if (!peerId || !content) return '错误：缺少 peerId 或 content';
        await channelManager.sendMessage('wecom', peerId, content);
        return `已发送到企微 ${peerId}`;
      },
    });
  }

  // ─── 微信工具 ──────────────────────────────────────────────────────
  if (currentChannel === 'weixin') {
    tools.push({
      name: 'weixin_send',
      description: '通过微信发送文本消息',
      channel: 'weixin',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '消息内容' },
        },
        required: ['content'],
      },
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
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '本地文件绝对路径或远程 URL' },
          text: { type: 'string', description: '附带说明文字（可选）' },
        },
        required: ['filePath'],
      },
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

type DocFileTypeParam = 'doc' | 'docx' | 'sheet' | 'file' | 'slides';

/**
 * 获取指定 Channel 的工具名列表（用于 tool-registry 注入）
 */
export function getChannelToolNames(channel: ChannelType): string[] {
  const base = ['desktop_notify'];
  switch (channel) {
    case 'feishu':
      return [
        ...base,
        'feishu_send',
        'feishu_card',
        'feishu_send_image',
        'feishu_send_file',
        'feishu_request_approval',
        'feishu_reply_comment',
        'feishu_add_whole_comment',
        'feishu_list_comment_replies',
      ];
    case 'wecom':
      return [...base, 'wecom_send'];
    case 'weixin':
      return [...base, 'weixin_send', 'weixin_send_media'];
    default:
      return base;
  }
}
