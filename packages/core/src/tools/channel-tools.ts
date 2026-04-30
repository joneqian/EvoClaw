/**
 * Channel 专属工具定义
 *
 * 为 Agent 暴露渠道能力。每个工具自带 JSON schema 参数描述，
 * 由 `channel-message-handler` 统一注入 peerId（无需 agent 填写）。
 */

import type { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelType } from '@evoclaw/shared';
import type { FeishuAdapter } from '../channel/adapters/feishu/index.js';
import { isImageFile } from '../channel/adapters/feishu/outbound/media.js';
import type { BindingRouter } from '../routing/binding-router.js';

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

/**
 * 剥掉飞书 `<at user_id="...">名字</at>` 标签，留下 "@名字"（M13 cross-app 修复）
 *
 * 背景：飞书 open_id 是 app-scoped 的——LLM 在 feishu_send / feishu_card content
 * 里写 `<at user_id="ou_xxx">名字</at>`，如果 ou_xxx 是从其他 viewer App 视角学来的，
 * 通过自己的 App 发送时会触发 99992361 "open_id cross app" 错误。
 *
 * @ 同事**必须用 mention_peer 工具**，工具内部走 peer-bot-registry 拿对的 viewer
 * 视角 open_id。feishu_send / feishu_card 里的 `<at>` 标签全部剥成纯文本 @ 兜底。
 *
 * 处理规则：
 *   - `<at user_id="ou_xxx">名字</at>`            → `@名字`
 *   - `<at user_id="ou_xxx">名字</at>` (无 text)  → `@`（保留语义提示）
 *   - `<at user_id="all"></at>`                   → `@所有人`
 *   - 自闭合 `<at user_id="..."/>`                → ``（移除）
 */
export function stripFeishuAtTags(content: string): { stripped: string; removed: number } {
  if (!content) return { stripped: content, removed: 0 };
  let removed = 0;
  // 1. <at user_id="all"></at> → @所有人
  let out = content.replace(/<at\s+user_id\s*=\s*["']all["']\s*>\s*<\/at>/gi, () => {
    removed++;
    return '@所有人';
  });
  // 2. <at user_id="..."/>（自闭合无文本）→ 移除
  out = out.replace(/<at\s+user_id\s*=\s*["'][^"']*["']\s*\/>/gi, () => {
    removed++;
    return '';
  });
  // 3. <at user_id="...">文本</at> → @文本
  out = out.replace(/<at\s+user_id\s*=\s*["'][^"']*["']\s*>([^<]*)<\/at>/gi, (_, text: string) => {
    removed++;
    return text.trim() ? `@${text.trim()}` : '@';
  });
  return { stripped: out, removed };
}

/** 检测错误是否为飞书 99992361 cross-app open_id（深翻 cause 链） */
function isCrossAppOpenIdError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const candidates: unknown[] = [err];
  // 沿 cause 链 + AxiosError.response.data 翻
  for (let i = 0; i < 5 && candidates.length > 0; i++) {
    const next = candidates.shift();
    if (next === null || typeof next !== 'object') continue;
    const obj = next as Record<string, unknown>;
    if (obj['code'] === 99992361) return true;
    const msg = obj['msg'];
    if (typeof msg === 'string' && msg.toLowerCase().includes('open_id cross app')) return true;
    const message = obj['message'];
    if (typeof message === 'string' && message.toLowerCase().includes('open_id cross app')) return true;
    if (obj['cause']) candidates.push(obj['cause']);
    const response = obj['response'] as Record<string, unknown> | undefined;
    if (response && typeof response === 'object') {
      candidates.push(response['data']);
    }
  }
  return false;
}

/**
 * 根据 agentId 反查 binding 表定位对应的飞书 accountId + adapter
 *
 * 绑定语义：Agent ↔ 飞书应用 **1:1**（产品约束），所以 agentId + channel='feishu'
 * 最多匹配一条 binding。若未绑定或找不到 adapter，抛带明确 accountId 的错误，
 * 便于 Agent / 前端根因排查。
 *
 * bindingRouter 可为 undefined（老调用栈兼容过渡期）；缺失时回退到 "拿该 channel
 * 下第一个 adapter"，相当于老单账号语义。
 */
function resolveFeishuAccount(
  channelManager: ChannelManager,
  bindingRouter: BindingRouter | undefined,
  agentId: string | undefined,
): { adapter: FeishuAdapter; accountId: string } {
  let accountId = '';
  if (bindingRouter && agentId) {
    const bindings = bindingRouter.listBindings(agentId).filter((b) => b.channel === 'feishu');
    if (bindings.length > 0) {
      accountId = bindings[0]!.accountId ?? '';
    }
  }
  const adapter = channelManager.getAdapter('feishu', accountId) as FeishuAdapter | undefined;
  if (!adapter) {
    throw new Error(
      `Agent ${agentId ?? '(未知)'} 未绑定可用的飞书应用 (accountId=${accountId || '(default)'})`,
    );
  }
  return { adapter, accountId };
}

/**
 * 创建 Channel 专属工具
 * 按当前通道动态注入（仅注入当前 Channel 的工具）
 *
 * `bindingRouter` 用于飞书工具按 agentId 反查 accountId 定位正确的 adapter
 * （多账号场景）。不传时退化为单账号语义（每个 channel type 只有一个 adapter）。
 */
export function createChannelTools(
  channelManager: ChannelManager,
  currentChannel: ChannelType,
  bindingRouter?: BindingRouter,
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
        const agentId = params['agentId'] as string | undefined;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !content) return '错误：缺少 peerId 或 content';
        const { accountId } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        // M13 cross-app 修复：99992361 自愈——LLM 在 content 里写了跨 app open_id 的 <at> 标签时，
        // 剥成纯文本 @ 重试一次，并把告警内容返回给 LLM 让它下次用 mention_peer
        try {
          await channelManager.sendMessage('feishu', accountId, peerId, content, chatType);
          return `已发送到飞书 ${peerId}`;
        } catch (err) {
          if (!isCrossAppOpenIdError(err)) throw err;
          const { stripped, removed } = stripFeishuAtTags(content);
          if (removed === 0) {
            // content 里没 <at> 标签但还报 cross-app（极罕见）— 让错误冒上去
            throw err;
          }
          await channelManager.sendMessage('feishu', accountId, peerId, stripped, chatType);
          return (
            `已发送到飞书 ${peerId}（自动剥除 ${removed} 个跨 app <at> 标签）。` +
            '⚠️ 下次 @ 同事请用 mention_peer 工具——feishu_send 的 content 里写 <at user_id="..."> 会跨 app 失败。'
          );
        }
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
        const agentId = params['agentId'] as string | undefined;
        if (!peerId || !card) return '错误：缺少 peerId 或 card';
        const { accountId } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        // M13 cross-app 修复：99992361 自愈（同 feishu_send）。card 是 JSON 字符串，
        // <at> 标签可能嵌在 markdown 字段里，用 regex 剥同样有效（只命中 <at user_id="..."> 形式）。
        try {
          await channelManager.sendMessage('feishu', accountId, peerId, card);
          return `已发送飞书卡片到 ${peerId}`;
        } catch (err) {
          if (!isCrossAppOpenIdError(err)) throw err;
          const { stripped, removed } = stripFeishuAtTags(card);
          if (removed === 0) throw err;
          await channelManager.sendMessage('feishu', accountId, peerId, stripped);
          return (
            `已发送飞书卡片到 ${peerId}（自动剥除 ${removed} 个跨 app <at> 标签）。` +
            '⚠️ 下次 @ 同事请用 mention_peer 工具——feishu_card 的 card content 里写 <at user_id="..."> 会跨 app 失败。'
          );
        }
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
        const agentId = params['agentId'] as string | undefined;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !filePath) return '错误：缺少 peerId 或 filePath';
        // FAIL-FAST：非图片扩展名不允许走此工具，避免静默降级为 file 路径
        if (!isImageFile(filePath)) {
          return `错误：filePath 不是图片扩展名（${filePath}），请改用 feishu_send_file`;
        }
        const { accountId } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        await channelManager.sendMediaMessage('feishu', accountId, peerId, filePath, caption, chatType);
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
        const agentId = params['agentId'] as string | undefined;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !filePath) return '错误：缺少 peerId 或 filePath';
        const { accountId } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        // 复用同一 sendMediaMessage 管道：内部按扩展名分 image/file 路径
        await channelManager.sendMediaMessage('feishu', accountId, peerId, filePath, caption, chatType);
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
          ttlMs: { type: 'number', description: 'TTL 毫秒数（默认 24 小时）' },
          operatorOpenId: { type: 'string', description: '限定的操作者 open_id（可选）' },
        },
        required: ['title', 'body'],
      },
      execute: async (params) => {
        // peerId 与 sessionKey 都由 channel-message-handler 自动注入（防 agent 伪造跨会话 key）
        const peerId = params['peerId'] as string;
        const sessionKey = params['sessionKey'] as string;
        const title = params['title'] as string;
        const body = params['body'] as string;
        const chatType = (params['chatType'] as 'private' | 'group') ?? 'private';
        if (!peerId || !sessionKey || !title || !body) {
          return '错误：缺少 peerId / sessionKey / title / body';
        }
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
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
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
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
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        const commentId = await adapter.addWholeCommentReply({ fileToken, fileType, text });
        return JSON.stringify({ comment_id: commentId });
      },
    });

    tools.push({
      name: 'feishu_replace_block_text',
      description:
        '替换飞书 docx 某文本块的内容（保留 block_type，仅换 text）。失败码 230108/230109 不会自动重试 —— 拿到错请重读 doc 后再尝试。',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: '文档唯一标识' },
          fileType: { type: 'string', description: '文档类型', enum: ['docx'] },
          blockId: { type: 'string', description: '要替换的 block_id（来自 feishu_read_doc）' },
          text: { type: 'string', description: '新的文本内容（纯文本）' },
          documentRevisionId: {
            type: 'number',
            description: '可选乐观锁：上次 read_doc 拿到的 revision；过期时返回 230108',
          },
        },
        required: ['fileToken', 'fileType', 'blockId', 'text'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const fileType = params['fileType'] as DocFileTypeParam;
        const blockId = params['blockId'] as string;
        const text = params['text'] as string;
        const documentRevisionId = params['documentRevisionId'] as number | undefined;
        if (!fileToken || !fileType || !blockId || !text) {
          return '错误：缺少 fileToken / fileType / blockId / text';
        }
        if (fileType !== 'docx') {
          return `错误：feishu_replace_block_text 当前仅支持 docx，收到 ${fileType}`;
        }
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        const replaceParams: {
          fileToken: string;
          fileType: DocFileTypeParam;
          blockId: string;
          text: string;
          documentRevisionId?: number;
          agentId?: string;
        } = { fileToken, fileType, blockId, text };
        if (typeof documentRevisionId === 'number') {
          replaceParams.documentRevisionId = documentRevisionId;
        }
        if (agentId) replaceParams.agentId = agentId;
        const result = await adapter.replaceDocBlock(replaceParams);
        return JSON.stringify({
          document_revision_id: result.revisionId,
          before_text: result.beforeText,
        });
      },
    });

    tools.push({
      name: 'feishu_delete_block',
      description:
        '删除飞书 docx 中的某 block。会先读文档查 parent + index 再删 — 失败码 230108/230109 不重试。',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: '文档唯一标识' },
          fileType: { type: 'string', description: '文档类型', enum: ['docx'] },
          blockId: { type: 'string', description: '要删除的 block_id（来自 feishu_read_doc）' },
          documentRevisionId: {
            type: 'number',
            description: '可选乐观锁',
          },
        },
        required: ['fileToken', 'fileType', 'blockId'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const fileType = params['fileType'] as DocFileTypeParam;
        const blockId = params['blockId'] as string;
        const documentRevisionId = params['documentRevisionId'] as number | undefined;
        if (!fileToken || !fileType || !blockId) {
          return '错误：缺少 fileToken / fileType / blockId';
        }
        if (fileType !== 'docx') {
          return `错误：feishu_delete_block 当前仅支持 docx，收到 ${fileType}`;
        }
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        const deleteParams: {
          fileToken: string;
          fileType: DocFileTypeParam;
          blockId: string;
          documentRevisionId?: number;
          agentId?: string;
        } = { fileToken, fileType, blockId };
        if (typeof documentRevisionId === 'number') {
          deleteParams.documentRevisionId = documentRevisionId;
        }
        if (agentId) deleteParams.agentId = agentId;
        const result = await adapter.deleteDocBlock(deleteParams);
        return JSON.stringify({
          document_revision_id: result.revisionId,
          deleted_text: result.deletedText,
        });
      },
    });

    tools.push({
      name: 'feishu_append_block',
      description:
        '在飞书 docx 末尾或某父 block 下追加一个文本块（最常见的 doc edit）。failure code 230108/230109 不会自动重试 —— 拿到错请重读 doc 后再尝试。',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: { type: 'string', description: '文档唯一标识（drive 事件 file_token）' },
          fileType: {
            type: 'string',
            description: '文档类型（v1 仅支持 docx）',
            enum: ['docx'],
          },
          text: { type: 'string', description: '要追加的文本内容（纯文本）' },
          parentBlockId: {
            type: 'string',
            description: '父 block_id（默认=fileToken=docx 根；指定时块作为该 block 的最后一个 child）',
          },
          documentRevisionId: {
            type: 'number',
            description: '可选乐观锁：上次 read_doc 拿到的 revision；不传时不校验版本，传入则版本过期时返回 230108',
          },
        },
        required: ['fileToken', 'fileType', 'text'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const fileType = params['fileType'] as DocFileTypeParam;
        const text = params['text'] as string;
        const parentBlockId = params['parentBlockId'] as string | undefined;
        const documentRevisionId = params['documentRevisionId'] as number | undefined;
        if (!fileToken || !fileType || !text) {
          return '错误：缺少 fileToken / fileType / text';
        }
        if (fileType !== 'docx') {
          return `错误：feishu_append_block 当前仅支持 docx，收到 ${fileType}`;
        }
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        const appendParams: {
          fileToken: string;
          fileType: DocFileTypeParam;
          text: string;
          parentBlockId?: string;
          documentRevisionId?: number;
        } = { fileToken, fileType, text };
        if (parentBlockId) appendParams.parentBlockId = parentBlockId;
        if (typeof documentRevisionId === 'number') {
          appendParams.documentRevisionId = documentRevisionId;
        }
        const result = await adapter.appendDocBlock(appendParams);
        return JSON.stringify({
          block_id: result.blockId,
          document_revision_id: result.revisionId,
        });
      },
    });

    tools.push({
      name: 'feishu_read_doc',
      description:
        '读取飞书 docx 全文（用于 agent 在 drive 评论触发后获取上下文，再决定如何回复/编辑）',
      channel: 'feishu',
      parameters: {
        type: 'object',
        properties: {
          fileToken: {
            type: 'string',
            description: '文档唯一标识（drive 事件 file_token / ChannelMessage.feishuDoc.fileToken）',
          },
          fileType: {
            type: 'string',
            description: '文档类型（v1 仅支持 docx）',
            enum: ['docx'],
          },
          maxChars: {
            type: 'number',
            description: 'plainText 最大字符数（默认 10000，超出截断并附 ...[truncated] 提示）',
          },
        },
        required: ['fileToken', 'fileType'],
      },
      execute: async (params) => {
        const fileToken = params['fileToken'] as string;
        const fileType = params['fileType'] as DocFileTypeParam;
        const maxChars = (params['maxChars'] as number | undefined) ?? 10000;
        if (!fileToken || !fileType) {
          return '错误：缺少 fileToken / fileType';
        }
        if (fileType !== 'docx') {
          return `错误：feishu_read_doc 当前仅支持 docx，收到 ${fileType}`;
        }
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
        const snapshot = await adapter.readDoc({ fileToken, fileType });
        const truncated = snapshot.plainText.length > maxChars;
        const text = truncated
          ? snapshot.plainText.slice(0, maxChars) + '\n...[truncated]'
          : snapshot.plainText;
        return JSON.stringify({
          document_id: snapshot.documentId,
          block_count: snapshot.blocks.length,
          text,
          truncated,
        });
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
        const agentId = params['agentId'] as string | undefined;
        const { adapter } = resolveFeishuAccount(channelManager, bindingRouter, agentId);
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
        'feishu_read_doc',
        'feishu_replace_block_text',
        'feishu_delete_block',
        'feishu_append_block',
      ];
    case 'wecom':
      return [...base, 'wecom_send'];
    case 'weixin':
      return [...base, 'weixin_send', 'weixin_send_media'];
    default:
      return base;
  }
}
