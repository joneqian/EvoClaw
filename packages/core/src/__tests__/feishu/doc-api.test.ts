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
  getDocContent,
  appendTextBlock,
  replaceBlockText,
  deleteBlock,
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

describe('getDocContent', () => {
  it('单页响应：扁平化 text/heading/code/list 各类 block', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            block_id: 'b1',
            block_type: 3,
            heading1: { elements: [{ text_run: { content: '标题一' } }] },
          },
          {
            block_id: 'b2',
            block_type: 2,
            text: { elements: [{ text_run: { content: '正文段 ' } }, { text_run: { content: 'cont' } }] },
          },
          {
            block_id: 'b3',
            block_type: 14,
            code: { elements: [{ text_run: { content: 'console.log(1)' } }] },
          },
          {
            block_id: 'b4',
            block_type: 12,
            bullet: { elements: [{ text_run: { content: 'item 1' } }] },
            parent_id: 'doc_root',
          },
        ],
      },
    });

    const snap = await getDocContent(client as unknown as Lark.Client, {
      fileToken: 'docx_token_a',
      fileType: 'docx',
    });

    expect(snap.documentId).toBe('docx_token_a');
    expect(snap.blocks).toHaveLength(4);
    expect(snap.blocks[0]).toMatchObject({ id: 'b1', type: 3, text: '标题一' });
    expect(snap.blocks[1]!.text).toBe('正文段 cont');
    expect(snap.blocks[2]!.text).toBe('console.log(1)');
    expect(snap.blocks[3]).toMatchObject({ id: 'b4', text: 'item 1', parentId: 'doc_root' });
    expect(snap.plainText).toBe('标题一\n正文段 cont\nconsole.log(1)\nitem 1');
  });

  it('mention_user / mention_doc element：扁平为 <user:id> / url', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          {
            block_id: 'b1',
            block_type: 2,
            text: {
              elements: [
                { text_run: { content: 'cc ' } },
                { mention_user: { user_id: 'u_alice' } },
                { text_run: { content: ' 看下 ' } },
                { mention_doc: { url: 'https://x.feishu.cn/doc/abc' } },
              ],
            },
          },
        ],
      },
    });

    const snap = await getDocContent(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
    });
    expect(snap.blocks[0]!.text).toBe('cc <user:u_alice> 看下 https://x.feishu.cn/doc/abc');
  });

  it('多页：has_more=true 时持续抓 page_token，扁平合并', async () => {
    const client = makeClient();
    client.request
      .mockResolvedValueOnce({
        code: 0,
        data: {
          has_more: true,
          page_token: 'p2',
          items: [
            { block_id: 'b1', block_type: 2, text: { elements: [{ text_run: { content: 'page1 a' } }] } },
          ],
        },
      })
      .mockResolvedValueOnce({
        code: 0,
        data: {
          has_more: false,
          items: [
            { block_id: 'b2', block_type: 2, text: { elements: [{ text_run: { content: 'page2 b' } }] } },
          ],
        },
      });

    const snap = await getDocContent(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
    });
    expect(snap.blocks).toHaveLength(2);
    expect(snap.plainText).toBe('page1 a\npage2 b');
    expect(client.request).toHaveBeenCalledTimes(2);
    // 第二次 URL 应带 page_token=p2
    expect(client.request.mock.calls[1]![0].url).toContain('page_token=p2');
  });

  it('空文本块（如分割线 / 图片）跳过 plainText 拼接', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          { block_id: 'b1', block_type: 2, text: { elements: [{ text_run: { content: 'real text' } }] } },
          { block_id: 'b2', block_type: 99 }, // 未知类型
          { block_id: 'b3', block_type: 2, text: { elements: [{ text_run: { content: 'next' } }] } },
        ],
      },
    });

    const snap = await getDocContent(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
    });
    expect(snap.blocks).toHaveLength(3);
    expect(snap.blocks[1]!.text).toBe(''); // 未知类型空文本
    expect(snap.plainText).toBe('real text\nnext'); // 但 plainText 跳过空块
  });

  it('非 docx file_type 直接抛错', async () => {
    const client = makeClient();
    await expect(
      getDocContent(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'sheet',
      }),
    ).rejects.toThrow(/只支持 docx/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('非零业务 code 抛 FeishuApiError', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 230003, msg: 'no permission' });
    await expect(
      getDocContent(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
      }),
    ).rejects.toThrow(FeishuApiError);
  });

  it('URL 含 file_token 编码（防特殊字符注入）', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 0, data: { has_more: false, items: [] } });
    await getDocContent(client as unknown as Lark.Client, {
      fileToken: 'tok with/space',
      fileType: 'docx',
    });
    expect(client.request.mock.calls[0]![0].url).toContain('tok%20with%2Fspace');
  });
});

describe('appendTextBlock', () => {
  it('成功路径：默认追加到 doc 根 + URL 含 documentId 编码', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        children: [{ block_id: 'new_block_42' }],
        document_revision_id: 12345,
      },
    });

    const result = await appendTextBlock(client as unknown as Lark.Client, {
      fileToken: 'docx_tok',
      fileType: 'docx',
      text: '这段是 agent 加的',
    });

    expect(result).toEqual({ blockId: 'new_block_42', revisionId: 12345 });
    expect(client.request).toHaveBeenCalledOnce();
    const call = client.request.mock.calls[0]![0];
    // parentBlockId 缺省 → block_id 路径段 = fileToken 自身（doc 根）
    expect(call.url).toBe(
      '/open-apis/docx/v1/documents/docx_tok/blocks/docx_tok/children',
    );
    expect(call.method).toBe('POST');
    expect(call.data).toEqual({
      children: [
        {
          block_type: 2,
          text: { elements: [{ text_run: { content: '这段是 agent 加的' } }] },
        },
      ],
    });
  });

  it('指定 parentBlockId：URL 用 parent block 而非 doc 根', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: { children: [{ block_id: 'b' }] },
    });

    await appendTextBlock(client as unknown as Lark.Client, {
      fileToken: 'docx_tok',
      fileType: 'docx',
      parentBlockId: 'parent_block_99',
      text: 'hi',
    });

    expect(client.request.mock.calls[0]![0].url).toBe(
      '/open-apis/docx/v1/documents/docx_tok/blocks/parent_block_99/children',
    );
  });

  it('documentRevisionId 透传到 query 参数', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 0, data: { children: [{}] } });
    await appendTextBlock(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      text: 'x',
      documentRevisionId: 999,
    });
    expect(client.request.mock.calls[0]![0].url).toContain('?document_revision_id=999');
  });

  it('未传 documentRevisionId 时 URL 不带 query', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 0, data: { children: [{}] } });
    await appendTextBlock(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      text: 'x',
    });
    expect(client.request.mock.calls[0]![0].url).not.toContain('?');
  });

  it('特殊字符的 fileToken / parentBlockId 走 URL 编码', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 0, data: { children: [{}] } });
    await appendTextBlock(client as unknown as Lark.Client, {
      fileToken: 'tok with/space',
      fileType: 'docx',
      parentBlockId: 'block/x',
      text: 'x',
    });
    const url = client.request.mock.calls[0]![0].url;
    expect(url).toContain('tok%20with%2Fspace');
    expect(url).toContain('block%2Fx');
  });

  it('230108（version 过期）抛 FeishuApiError，不在 doc-api 层重试', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 230108,
      msg: 'document_revision_id expired',
    });

    await expect(
      appendTextBlock(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        text: 'x',
        documentRevisionId: 100,
      }),
    ).rejects.toThrow(FeishuApiError);
    expect(client.request).toHaveBeenCalledOnce(); // 不重试
  });

  it('230109（block 不存在）抛 FeishuApiError', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 230109, msg: 'block not found' });
    await expect(
      appendTextBlock(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        parentBlockId: 'nonexistent',
        text: 'x',
      }),
    ).rejects.toThrow(FeishuApiError);
  });

  it('非 docx fileType 直接抛错（v1 范围限制）', async () => {
    const client = makeClient();
    await expect(
      appendTextBlock(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'sheet',
        text: 'x',
      }),
    ).rejects.toThrow(/只支持 docx/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('响应缺 children 时 blockId/revisionId 都为 null（不抛）', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 0, data: {} });
    const result = await appendTextBlock(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      text: 'x',
    });
    expect(result).toEqual({ blockId: null, revisionId: null });
  });
});

describe('replaceBlockText', () => {
  it('成功路径：PATCH 到 /documents/X/blocks/Y + body 含 update_text_elements', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: { document_revision_id: 7 },
    });

    const result = await replaceBlockText(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      blockId: 'b_42',
      text: '新内容',
    });

    expect(result.revisionId).toBe(7);
    const call = client.request.mock.calls[0]![0];
    expect(call.url).toBe('/open-apis/docx/v1/documents/tok/blocks/b_42');
    expect(call.method).toBe('PATCH');
    expect(call.data).toEqual({
      update_text_elements: {
        elements: [{ text_run: { content: '新内容' } }],
      },
    });
  });

  it('documentRevisionId 透传到 query', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 0, data: {} });
    await replaceBlockText(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      blockId: 'b',
      text: 'x',
      documentRevisionId: 99,
    });
    expect(client.request.mock.calls[0]![0].url).toContain('?document_revision_id=99');
  });

  it('230108（version 过期）抛 FeishuApiError，不重试', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({ code: 230108, msg: 'expired' });
    await expect(
      replaceBlockText(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        blockId: 'b',
        text: 'x',
      }),
    ).rejects.toThrow(FeishuApiError);
    expect(client.request).toHaveBeenCalledOnce();
  });

  it('非 docx 直接抛错', async () => {
    const client = makeClient();
    await expect(
      replaceBlockText(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'sheet',
        blockId: 'b',
        text: 'x',
      }),
    ).rejects.toThrow(/只支持 docx/);
    expect(client.request).not.toHaveBeenCalled();
  });
});

describe('deleteBlock', () => {
  it('成功路径：先读 doc 找 parent + index，再 batch_delete', async () => {
    const client = makeClient();
    // 第一次 request：getDocContent
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          { block_id: 'b_a', block_type: 2, parent_id: 'doc_root', text: { elements: [{ text_run: { content: 'A' } }] } },
          { block_id: 'b_b', block_type: 2, parent_id: 'doc_root', text: { elements: [{ text_run: { content: 'B' } }] } },
          { block_id: 'b_c', block_type: 2, parent_id: 'doc_root', text: { elements: [{ text_run: { content: 'C' } }] } },
        ],
      },
    });
    // 第二次 request：batch_delete
    client.request.mockResolvedValueOnce({
      code: 0,
      data: { document_revision_id: 12 },
    });

    const result = await deleteBlock(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      blockId: 'b_b',
    });

    expect(result).toEqual({ revisionId: 12, deletedText: 'B' });
    expect(client.request).toHaveBeenCalledTimes(2);
    const call2 = client.request.mock.calls[1]![0];
    expect(call2.url).toBe(
      '/open-apis/docx/v1/documents/tok/blocks/doc_root/children/batch_delete',
    );
    expect(call2.method).toBe('DELETE');
    expect(call2.data).toEqual({ start_index: 1, end_index: 2 });
  });

  it('block_id 不存在抛错（不调 batch_delete）', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: { has_more: false, items: [{ block_id: 'b_x', block_type: 2 }] },
    });

    await expect(
      deleteBlock(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        blockId: 'b_y',
      }),
    ).rejects.toThrow(/找不到 block_id/);
    expect(client.request).toHaveBeenCalledOnce(); // 只调了 read，没调 delete
  });

  it('parent_id 缺失时 fallback 用 fileToken 作为 parent（doc 根）', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [
          // 没有 parent_id 字段（root 直系子）
          { block_id: 'b_a', block_type: 2, text: { elements: [{ text_run: { content: 'A' } }] } },
        ],
      },
    });
    client.request.mockResolvedValueOnce({ code: 0, data: { document_revision_id: 1 } });

    await deleteBlock(client as unknown as Lark.Client, {
      fileToken: 'tok',
      fileType: 'docx',
      blockId: 'b_a',
    });
    const call2 = client.request.mock.calls[1]![0];
    expect(call2.url).toContain('/blocks/tok/children/batch_delete'); // parent fallback = fileToken
  });

  it('230108 抛 FeishuApiError', async () => {
    const client = makeClient();
    client.request.mockResolvedValueOnce({
      code: 0,
      data: {
        has_more: false,
        items: [{ block_id: 'b', block_type: 2, parent_id: 'doc_root', text: { elements: [] } }],
      },
    });
    client.request.mockResolvedValueOnce({ code: 230108, msg: 'expired' });

    await expect(
      deleteBlock(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'docx',
        blockId: 'b',
      }),
    ).rejects.toThrow(FeishuApiError);
  });

  it('非 docx 抛错', async () => {
    const client = makeClient();
    await expect(
      deleteBlock(client as unknown as Lark.Client, {
        fileToken: 'tok',
        fileType: 'sheet',
        blockId: 'b',
      }),
    ).rejects.toThrow(/只支持 docx/);
    expect(client.request).not.toHaveBeenCalled();
  });
});
