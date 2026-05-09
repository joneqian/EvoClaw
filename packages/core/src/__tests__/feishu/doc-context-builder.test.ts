/**
 * M13 Phase 5: doc-context-builder 单测
 *
 * 覆盖：
 *   - 最小 context block（无 adapter / skipTimeline）
 *   - 完整 timeline block（adapter 返回多条 reply）
 *   - timeline 拉取失败 silent fallback
 *   - 全文评论 vs thread 内评论 attr 渲染差异
 *   - timeline 默认 5 条 / maxTimelineReplies 覆盖
 *   - 长文本截断 + XML 转义
 */

import { describe, it, expect, vi } from 'vitest';
import type { FeishuDocContext } from '@evoclaw/shared';
import { buildFeishuDocContextPrefix } from '../../channel/adapters/feishu/inbound/doc-context-builder.js';

// 类型简化：测试只需要 listCommentReplies 这一个方法
interface MockReplyResult {
  replies: Array<{ reply_id?: string; user_id?: string; text: string; createTime?: number }>;
  hasMore: boolean;
  nextPageToken?: string;
}
interface MockAdapter {
  listCommentReplies: (params: unknown) => Promise<MockReplyResult>;
}

function makeAdapter(replies: MockReplyResult['replies']): MockAdapter {
  return {
    listCommentReplies: vi.fn().mockResolvedValue({
      replies,
      hasMore: false,
    }),
  };
}

const baseDoc: FeishuDocContext = {
  fileToken: 'doccnxxx',
  fileType: 'docx',
  commentId: 'cmt_001',
  isWhole: false,
  replyId: 'reply_002',
};

describe('buildFeishuDocContextPrefix', () => {
  it('无 adapter 时返回最小 context block（无 timeline）', async () => {
    const result = await buildFeishuDocContextPrefix(baseDoc);
    expect(result).toContain('<feishu_doc_context>');
    expect(result).toContain('token="doccnxxx"');
    expect(result).toContain('type="docx"');
    expect(result).toContain('id="cmt_001"');
    expect(result).toContain('reply_id="reply_002"');
    expect(result).toContain('is_whole="false"');
    expect(result).not.toContain('<comment_timeline>');
  });

  it('skipTimeline=true 跳过 timeline 拉取', async () => {
    const adapter = makeAdapter([{ reply_id: 'r1', user_id: 'ou_a', text: '...' }]);
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
      { skipTimeline: true },
    );
    expect(result).not.toContain('<comment_timeline>');
    expect(adapter.listCommentReplies).not.toHaveBeenCalled();
  });

  it('adapter 返回 timeline → 渲染 <comment_timeline> 块', async () => {
    const adapter = makeAdapter([
      { reply_id: 'r1', user_id: 'ou_alice', text: '前面有人提议用 markdown', createTime: 1715000000 },
      { reply_id: 'r2', user_id: 'ou_bob', text: '支持 +1', createTime: 1715000300 },
    ]);
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
    );
    expect(result).toContain('<comment_timeline>');
    expect(result).toContain('user="ou_alice"');
    expect(result).toContain('前面有人提议用 markdown');
    expect(result).toContain('user="ou_bob"');
    expect(result).toContain('支持 +1');
    expect(adapter.listCommentReplies).toHaveBeenCalledWith({
      fileToken: 'doccnxxx',
      commentId: 'cmt_001',
      fileType: 'docx',
      pageSize: 5,
    });
  });

  it('adapter 抛错 → silent fallback 返回最小 context block', async () => {
    const adapter: MockAdapter = {
      listCommentReplies: vi.fn().mockRejectedValue(new Error('rate limited')),
    };
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
    );
    expect(result).toContain('<feishu_doc_context>');
    expect(result).not.toContain('<comment_timeline>');
  });

  it('adapter 返回空 replies → 不渲染 timeline 块', async () => {
    const adapter = makeAdapter([]);
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
    );
    expect(result).not.toContain('<comment_timeline>');
  });

  it('全文评论（isWhole=true）正确渲染 attr', async () => {
    const wholeDoc: FeishuDocContext = {
      fileToken: 'doc_b',
      fileType: 'docx',
      commentId: 'cmt_whole',
      isWhole: true,
    };
    const result = await buildFeishuDocContextPrefix(wholeDoc);
    expect(result).toContain('is_whole="true"');
    expect(result).not.toContain('reply_id=');
  });

  it('maxTimelineReplies=2 限制返回最近 2 条', async () => {
    const adapter = makeAdapter([
      { reply_id: 'r1', user_id: 'ou_1', text: 'A', createTime: 1715000000 },
      { reply_id: 'r2', user_id: 'ou_2', text: 'B', createTime: 1715000100 },
      { reply_id: 'r3', user_id: 'ou_3', text: 'C', createTime: 1715000200 },
      { reply_id: 'r4', user_id: 'ou_4', text: 'D', createTime: 1715000300 },
    ]);
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
      { maxTimelineReplies: 2 },
    );
    // 取最近 2 条（按 createTime 升序末尾两个）
    expect(result).not.toContain('user="ou_1"');
    expect(result).not.toContain('user="ou_2"');
    expect(result).toContain('user="ou_3"');
    expect(result).toContain('user="ou_4"');
    expect(adapter.listCommentReplies).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 2 }));
  });

  it('长文本截断到 200 字符 + 加省略号', async () => {
    const longText = 'A'.repeat(250);
    const adapter = makeAdapter([
      { reply_id: 'r1', user_id: 'ou_a', text: longText, createTime: 1715000000 },
    ]);
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
    );
    expect(result).toContain('A'.repeat(200) + '…');
    expect(result).not.toContain('A'.repeat(201));
  });

  it('XML 特殊字符转义（防 attr / body 注入）', async () => {
    const docWithSpecial: FeishuDocContext = {
      fileToken: 'doc<script>',
      fileType: 'docx',
      commentId: 'cmt&"id',
      isWhole: false,
    };
    const adapter = makeAdapter([
      { reply_id: 'r1', user_id: 'ou', text: '<reply>恶意</reply>', createTime: 1715000000 },
    ]);
    const result = await buildFeishuDocContextPrefix(
      docWithSpecial,
      { feishuAdapter: adapter as never },
    );
    // attr 转义
    expect(result).toContain('token="doc&lt;script&gt;"');
    expect(result).toContain('id="cmt&amp;&quot;id"');
    // body 转义
    expect(result).toContain('&lt;reply&gt;恶意&lt;/reply&gt;');
    expect(result).not.toContain('<reply>恶意</reply>');
  });

  it('timeline 时间戳渲染（unix seconds）', async () => {
    const adapter = makeAdapter([
      { reply_id: 'r1', user_id: 'ou', text: 'hi', createTime: 1715000000 },
    ]);
    const result = await buildFeishuDocContextPrefix(
      baseDoc,
      { feishuAdapter: adapter as never },
    );
    // 1715000000 → 2024-05-06T14:13
    expect(result).toMatch(/at="2024-05-06T\d{2}:\d{2}"/);
  });
});
