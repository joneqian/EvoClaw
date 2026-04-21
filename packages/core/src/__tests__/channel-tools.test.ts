import { describe, it, expect, vi } from 'vitest';
import { createChannelTools, getChannelToolNames } from '../tools/channel-tools.js';
import type { ChannelManager } from '../channel/channel-manager.js';
import type { FeishuAdapter } from '../channel/adapters/feishu/index.js';

/** 基础 mock：仅 sendMessage */
function createMockChannelManager(): ChannelManager {
  return {
    sendMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    getAdapter: vi.fn(),
  } as unknown as ChannelManager;
}

/** 完整 mock：带 sendMedia + getAdapter → FeishuAdapter */
function createFullFeishuMock(): {
  cm: ChannelManager;
  adapter: {
    requestApproval: ReturnType<typeof vi.fn>;
    replyToComment: ReturnType<typeof vi.fn>;
    addWholeCommentReply: ReturnType<typeof vi.fn>;
    listCommentReplies: ReturnType<typeof vi.fn>;
  };
} {
  const adapter = {
    requestApproval: vi.fn().mockResolvedValue({ decision: 'approve', operatorOpenId: 'ou_u' }),
    replyToComment: vi.fn().mockResolvedValue('rp_new'),
    addWholeCommentReply: vi.fn().mockResolvedValue('cm_new'),
    listCommentReplies: vi.fn().mockResolvedValue({
      replies: [{ reply_id: 'rp_1', user_id: 'ou_u', text: '已处理' }],
      hasMore: false,
    }),
  };
  const cm = {
    sendMessage: vi.fn(),
    sendMediaMessage: vi.fn(),
    getAdapter: vi.fn().mockReturnValue(adapter as unknown as FeishuAdapter),
  } as unknown as ChannelManager;
  return { cm, adapter };
}

describe('createChannelTools', () => {
  it('local channel 应该只有 desktop_notify', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'local');
    expect(tools.map((t) => t.name)).toEqual(['desktop_notify']);
  });

  it('feishu channel 暴露 desktop_notify + 7 个飞书工具', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'desktop_notify',
      'feishu_send',
      'feishu_card',
      'feishu_send_image',
      'feishu_send_file',
      'feishu_request_approval',
      'feishu_reply_comment',
      'feishu_add_whole_comment',
      'feishu_list_comment_replies',
    ]);
    // 每个工具都带 JSON schema parameters
    for (const tool of tools) {
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties).toBeTruthy();
    }
  });

  it('wecom channel 应该有 desktop_notify + wecom_send', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'wecom');
    const names = tools.map((t) => t.name);
    expect(names).toContain('desktop_notify');
    expect(names).toContain('wecom_send');
    expect(names).toHaveLength(2);
  });

  it('desktop_notify 应该返回成功标记', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'local');
    const notifyTool = tools.find((t) => t.name === 'desktop_notify')!;

    const result = await notifyTool.execute({ title: '测试', body: '消息体' });
    const parsed = JSON.parse(result);
    expect(parsed.sent).toBe(true);
    expect(parsed.title).toBe('测试');
    expect(parsed.body).toBe('消息体');
  });

  it('feishu_send 缺少参数应返回错误提示', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const sendTool = tools.find((t) => t.name === 'feishu_send')!;

    const result = await sendTool.execute({});
    expect(result).toContain('错误');
  });

  it('feishu_send 正常调用应发送消息', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const sendTool = tools.find((t) => t.name === 'feishu_send')!;

    await sendTool.execute({ peerId: 'ou_123', content: '你好', chatType: 'private' });
    expect(cm.sendMessage).toHaveBeenCalledWith('feishu', 'ou_123', '你好', 'private');
  });

  it('feishu_send_image 调用 sendMediaMessage 并带 caption', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_send_image')!;

    await tool.execute({
      peerId: 'ou_u',
      filePath: '/tmp/a.png',
      caption: '给你看图',
      chatType: 'private',
    });
    expect(cm.sendMediaMessage).toHaveBeenCalledWith(
      'feishu',
      'ou_u',
      '/tmp/a.png',
      '给你看图',
      'private',
    );
  });

  it('feishu_send_image 非图片扩展名 FAIL-FAST 提示改用 send_file', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_send_image')!;
    const result = await tool.execute({ peerId: 'ou_u', filePath: '/tmp/a.pdf' });
    expect(result).toContain('不是图片');
    expect(result).toContain('feishu_send_file');
    expect(cm.sendMediaMessage).not.toHaveBeenCalled();
  });

  it('feishu_request_approval schema 不再 require sessionKey（由 handler 注入）', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_request_approval')!;
    expect(tool.parameters.required).toEqual(['title', 'body']);
    // sessionKey 仍然可在 description 里说明，但不是 agent-facing 的必填
    expect(tool.parameters.required).not.toContain('sessionKey');
  });

  it('feishu_send_file 复用 sendMediaMessage 管道', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_send_file')!;

    await tool.execute({ peerId: 'ou_u', filePath: '/tmp/a.pdf' });
    expect(cm.sendMediaMessage).toHaveBeenCalledWith(
      'feishu',
      'ou_u',
      '/tmp/a.pdf',
      undefined,
      'private',
    );
  });

  it('feishu_send_image 缺 filePath 返回错误', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_send_image')!;
    expect(await tool.execute({ peerId: 'ou_u' })).toContain('错误');
    expect(cm.sendMediaMessage).not.toHaveBeenCalled();
  });

  it('feishu_request_approval 调用 adapter.requestApproval 并返回 JSON', async () => {
    const { cm, adapter } = createFullFeishuMock();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_request_approval')!;

    const result = await tool.execute({
      peerId: 'ou_u',
      title: '执行删除？',
      body: '将删除文件 a.txt',
      sessionKey: 'agent:a:feishu:dm:ou_u',
      ttlMs: 60_000,
      operatorOpenId: 'ou_admin',
      chatType: 'private',
    });
    expect(adapter.requestApproval).toHaveBeenCalledWith(
      'ou_u',
      expect.objectContaining({
        title: '执行删除？',
        body: '将删除文件 a.txt',
        sessionKey: 'agent:a:feishu:dm:ou_u',
        ttlMs: 60_000,
        operatorOpenId: 'ou_admin',
      }),
      'private',
    );
    expect(JSON.parse(result)).toEqual({ decision: 'approve', operatorOpenId: 'ou_u' });
  });

  it('feishu_request_approval 缺必填返回错误', async () => {
    const { cm } = createFullFeishuMock();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_request_approval')!;
    expect(await tool.execute({ peerId: 'ou_u', title: '', body: '', sessionKey: '' })).toContain(
      '错误',
    );
  });

  it('feishu_reply_comment 调用 adapter.replyToComment 并返回 reply_id', async () => {
    const { cm, adapter } = createFullFeishuMock();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_reply_comment')!;

    const result = await tool.execute({
      fileToken: 'doccn_1',
      commentId: 'cm_1',
      fileType: 'docx',
      text: '机器人回复',
    });
    expect(adapter.replyToComment).toHaveBeenCalledWith({
      fileToken: 'doccn_1',
      commentId: 'cm_1',
      fileType: 'docx',
      text: '机器人回复',
    });
    expect(JSON.parse(result).reply_id).toBe('rp_new');
  });

  it('feishu_add_whole_comment 调用 adapter.addWholeCommentReply', async () => {
    const { cm, adapter } = createFullFeishuMock();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_add_whole_comment')!;

    const result = await tool.execute({
      fileToken: 'doccn_1',
      fileType: 'doc',
      text: '全文评论',
    });
    expect(adapter.addWholeCommentReply).toHaveBeenCalledWith({
      fileToken: 'doccn_1',
      fileType: 'doc',
      text: '全文评论',
    });
    expect(JSON.parse(result).comment_id).toBe('cm_new');
  });

  it('feishu_list_comment_replies 调用 adapter.listCommentReplies', async () => {
    const { cm, adapter } = createFullFeishuMock();
    const tools = createChannelTools(cm, 'feishu');
    const tool = tools.find((t) => t.name === 'feishu_list_comment_replies')!;

    const result = await tool.execute({
      fileToken: 'doccn_1',
      commentId: 'cm_1',
      fileType: 'docx',
      pageSize: 10,
    });
    expect(adapter.listCommentReplies).toHaveBeenCalledWith({
      fileToken: 'doccn_1',
      commentId: 'cm_1',
      fileType: 'docx',
      pageSize: 10,
    });
    const parsed = JSON.parse(result);
    expect(parsed.replies).toHaveLength(1);
    expect(parsed.hasMore).toBe(false);
  });

  it.each([
    'feishu_request_approval',
    'feishu_reply_comment',
    'feishu_add_whole_comment',
    'feishu_list_comment_replies',
  ])('%s 在飞书 adapter 未注册时抛错', async (toolName) => {
    const cm = {
      sendMessage: vi.fn(),
      sendMediaMessage: vi.fn(),
      getAdapter: vi.fn().mockReturnValue(undefined),
    } as unknown as ChannelManager;
    const tool = createChannelTools(cm, 'feishu').find((t) => t.name === toolName)!;
    await expect(
      tool.execute({
        peerId: 'ou_u',
        sessionKey: 's',
        title: 't',
        body: 'b',
        fileToken: 'f',
        commentId: 'c',
        fileType: 'docx',
        text: 't',
      }),
    ).rejects.toThrow(/未注册/);
  });

  it('wecom_send 缺少参数应返回错误提示', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'wecom');
    const sendTool = tools.find((t) => t.name === 'wecom_send')!;

    const result = await sendTool.execute({});
    expect(result).toContain('错误');
  });
});

describe('getChannelToolNames', () => {
  it('local 返回 [desktop_notify]', () => {
    expect(getChannelToolNames('local')).toEqual(['desktop_notify']);
  });

  it('feishu 返回 8 个工具名', () => {
    const names = getChannelToolNames('feishu');
    expect(names).toEqual([
      'desktop_notify',
      'feishu_send',
      'feishu_card',
      'feishu_send_image',
      'feishu_send_file',
      'feishu_request_approval',
      'feishu_reply_comment',
      'feishu_add_whole_comment',
      'feishu_list_comment_replies',
    ]);
  });

  it('wecom 返回 2 个工具名', () => {
    const names = getChannelToolNames('wecom');
    expect(names).toEqual(['desktop_notify', 'wecom_send']);
  });

  it('未知 channel 返回 [desktop_notify]', () => {
    expect(getChannelToolNames('dingtalk')).toEqual(['desktop_notify']);
  });
});
