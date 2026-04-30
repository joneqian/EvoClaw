/**
 * doc-api.ts 单测基线
 *
 * Phase C0：在 Phase C 后续 PR 加 read/edit 之前先把已有 3 个 comment API +
 * `toTextElements` helper 的测试覆盖率拉到能信赖的基线（plan agent 反馈：堆 7a/7b/7c
 * 之前应该有 known-good baseline）。
 *
 * mock SDK：客户端只暴露被测函数实际调用的字段，不复制整个 Lark.Client 树。
 */

import { describe, it, expect, vi } from 'vitest';
import type * as Lark from '@larksuiteoapi/node-sdk';

import {
  addWholeCommentReply,
  replyToComment,
  listCommentReplies,
  toTextElements,
} from '../../channel/adapters/feishu/doc/doc-api.js';
import { FeishuApiError } from '../../channel/adapters/feishu/outbound/index.js';

interface FileCommentClientStub {
  drive: {
    v1: {
      fileComment: { create: ReturnType<typeof vi.fn> };
      fileCommentReply: { list: ReturnType<typeof vi.fn> };
    };
  };
  request: ReturnType<typeof vi.fn>;
}

function makeClient(): FileCommentClientStub {
  return {
    drive: {
      v1: {
        fileComment: {
          create: vi.fn(),
        },
        fileCommentReply: {
          list: vi.fn(),
        },
      },
    },
    request: vi.fn(),
  };
}

describe('toTextElements', () => {
  it('生成单个 text_run 元素', () => {
    expect(toTextElements('hello')).toEqual([
      { type: 'text_run', text_run: { text: 'hello' } },
    ]);
  });

  it('空字符串也产出 text_run（不 skip）', () => {
    expect(toTextElements('')).toEqual([
      { type: 'text_run', text_run: { text: '' } },
    ]);
  });
});

describe('addWholeCommentReply', () => {
  it('成功路径：调用 fileComment.create 并返回 comment_id', async () => {
    const client = makeClient();
    client.drive.v1.fileComment.create.mockResolvedValueOnce({
      code: 0,
      data: { comment_id: 'cmt_123' },
    });

    const result = await addWholeCommentReply(client as unknown as Lark.Client, {
      fileToken: 'doc_token_abc',
      fileType: 'docx',
      text: '帮我看下这段',
    });

    expect(result).toBe('cmt_123');
    expect(client.drive.v1.fileComment.create).toHaveBeenCalledOnce();
    const call = client.drive.v1.fileComment.create.mock.calls[0]![0];
    expect(call.params).toEqual({ file_type: 'docx' });
    expect(call.path).toEqual({ file_token: 'doc_token_abc' });
    expect(call.data.reply_list.replies[0].content.elements).toEqual([
      { type: 'text_run', text_run: { text: '帮我看下这段' } },
    ]);
  });

  it('comment_id 缺失返回 null（业务码 0 但 data 不全）', async () => {
    const client = makeClient();
    client.drive.v1.fileComment.create.mockResolvedValueOnce({ code: 0, data: {} });

    const result = await addWholeCommentReply(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'doc',
      text: 't',
    });

    expect(result).toBeNull();
  });

  it('非零 code 抛 FeishuApiError 携带 code 与 msg', async () => {
    const client = makeClient();
    // 用 mockResolvedValue（非 Once）：测试内会调两次 addWholeCommentReply
    client.drive.v1.fileComment.create.mockResolvedValue({
      code: 230003,
      msg: 'permission denied',
    });

    await expect(
      addWholeCommentReply(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        text: 't',
      }),
    ).rejects.toThrow(FeishuApiError);

    let captured: unknown = null;
    try {
      await addWholeCommentReply(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        text: 't',
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(FeishuApiError);
    expect((captured as FeishuApiError).code).toBe(230003);
    expect((captured as FeishuApiError).msg).toBe('permission denied');
  });
});

describe('replyToComment', () => {
  it('成功路径：URL-encoded path + query 参数 + 返回 reply_id', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: { reply_id: 'rep_456' },
    });

    const result = await replyToComment(client as unknown as Lark.Client, {
      fileToken: 'tok with space',
      commentId: 'cmt/123',
      fileType: 'docx',
      text: '回复 一下',
    });

    expect(result).toBe('rep_456');
    expect(client.request).toHaveBeenCalledOnce();
    const call = client.request.mock.calls[0]![0];
    // URL 编码：空格 → %20，斜杠 → %2F
    expect(call.url).toBe(
      '/open-apis/drive/v1/files/tok%20with%20space/comments/cmt%2F123/replies?file_type=docx',
    );
    expect(call.method).toBe('POST');
    expect(call.data.content.elements).toEqual([
      { type: 'text_run', text_run: { text: '回复 一下' } },
    ]);
  });

  it('白名单外的 file_type 抛错（防 bitable / mindnote 等扩展值）', async () => {
    const client = makeClient();
    await expect(
      replyToComment(client as unknown as Lark.Client, {
        fileToken: 'tok',
        commentId: 'cmt',
        fileType: 'bitable' as never,
        text: 't',
      }),
    ).rejects.toThrow(/不支持的 file_type/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('非零 code 抛 FeishuApiError', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 99991400, msg: 'rate limit' });

    await expect(
      replyToComment(client as unknown as Lark.Client, {
        fileToken: 'tok',
        commentId: 'cmt',
        fileType: 'docx',
        text: 't',
      }),
    ).rejects.toThrow(FeishuApiError);
  });
});

describe('listCommentReplies', () => {
  it('扁平化 elements：text_run / docs_link / person 拼成单一 text', async () => {
    const client = makeClient();
    client.drive.v1.fileCommentReply.list.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            reply_id: 'r1',
            user_id: 'u_alice',
            create_time: 1700000000,
            content: {
              elements: [
                { type: 'text_run', text_run: { text: '看下这个 ' } },
                { type: 'docs_link', docs_link: { url: 'https://x.feishu.cn/doc/abc' } },
                { type: 'text_run', text_run: { text: ' cc ' } },
                { type: 'person', person: { user_id: 'u_bob' } },
              ],
            },
          },
        ],
      },
    });

    const result = await listCommentReplies(client as unknown as Lark.Client, {
      fileToken: 'tok',
      commentId: 'cmt',
      fileType: 'docx',
    });

    expect(result.hasMore).toBe(false);
    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]!.text).toBe(
      '看下这个 https://x.feishu.cn/doc/abc cc <user:u_bob>',
    );
    expect(result.replies[0]!.reply_id).toBe('r1');
    expect(result.replies[0]!.user_id).toBe('u_alice');
    expect(result.replies[0]!.createTime).toBe(1700000000);
  });

  it('分页：透传 pageSize / pageToken 并返回 nextPageToken', async () => {
    const client = makeClient();
    client.drive.v1.fileCommentReply.list.mockResolvedValueOnce({
      code: 0,
      data: { has_more: true, page_token: 'next_xyz', items: [] },
    });

    const result = await listCommentReplies(client as unknown as Lark.Client, {
      fileToken: 'tok',
      commentId: 'cmt',
      fileType: 'docx',
      pageSize: 50,
      pageToken: 'cur_abc',
    });

    expect(result.hasMore).toBe(true);
    expect(result.nextPageToken).toBe('next_xyz');
    const call = client.drive.v1.fileCommentReply.list.mock.calls[0]![0];
    expect(call.params).toMatchObject({
      file_type: 'docx',
      page_size: 50,
      page_token: 'cur_abc',
    });
  });

  it('items 为空时返回空 replies + hasMore=false', async () => {
    const client = makeClient();
    client.drive.v1.fileCommentReply.list.mockResolvedValueOnce({
      code: 0,
      data: {},
    });

    const result = await listCommentReplies(client as unknown as Lark.Client, {
      fileToken: 'tok',
      commentId: 'cmt',
      fileType: 'docx',
    });

    expect(result.replies).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPageToken).toBeUndefined();
  });

  it('非零 code 抛 FeishuApiError', async () => {
    const client = makeClient();
    client.drive.v1.fileCommentReply.list.mockResolvedValueOnce({
      code: 230011,
      msg: 'forbidden',
    });

    await expect(
      listCommentReplies(client as unknown as Lark.Client, {
        fileToken: 'tok',
        commentId: 'cmt',
        fileType: 'docx',
      }),
    ).rejects.toThrow(FeishuApiError);
  });

  it('未知 element 类型被静默跳过（产出空字符串）', async () => {
    const client = makeClient();
    client.drive.v1.fileCommentReply.list.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            reply_id: 'r1',
            content: {
              elements: [
                { type: 'text_run', text_run: { text: 'hi ' } },
                { type: 'unknown_future_type' },
                { type: 'text_run', text_run: { text: ' end' } },
              ],
            },
          },
        ],
      },
    });

    const result = await listCommentReplies(client as unknown as Lark.Client, {
      fileToken: 'tok',
      commentId: 'cmt',
      fileType: 'docx',
    });

    expect(result.replies[0]!.text).toBe('hi  end');
  });
});
