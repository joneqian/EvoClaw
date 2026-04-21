/**
 * PR5 测试：Phase I（drive 评论事件 + doc API）+ Phase J（retry 退避）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerOtherEventHandlers,
  type FeishuDriveCommentEvent,
  type FeishuEventCallbacks,
} from '../../channel/adapters/feishu/event-handlers.js';
import {
  addWholeCommentReply,
  replyToComment,
  listCommentReplies,
  toTextElements,
} from '../../channel/adapters/feishu/doc-api.js';
import {
  withFeishuRetry,
  isRetryableFeishuError,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
} from '../../channel/adapters/feishu/retry.js';
import { FeishuApiError } from '../../channel/adapters/feishu/outbound.js';

// ─── Phase I-1: drive 评论事件 ──────────────────────────────────────

describe('drive.notice.comment_add_v1 事件路由', () => {
  let handlers: Record<string, (data: unknown) => Promise<void>>;
  let callbacks: FeishuEventCallbacks;
  const dispatcher = {
    register: (h: Record<string, (data: unknown) => Promise<void>>) => {
      handlers = { ...handlers, ...h };
      return dispatcher;
    },
  } as any;

  beforeEach(() => {
    handlers = {};
    callbacks = {};
    registerOtherEventHandlers(dispatcher, {
      getCallbacks: () => callbacks,
    });
  });

  it('文档新评论事件触发 onDriveCommentAdd', async () => {
    const spy = vi.fn();
    callbacks.onDriveCommentAdd = spy;
    const event: FeishuDriveCommentEvent = {
      file_token: 'doccnABC',
      file_type: 'docx',
      comment_id: 'cm_001',
      from_open_id: 'ou_user',
      is_whole: true,
      content: '这段需要修改',
    };
    await handlers['drive.notice.comment_add_v1']!(event);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].file_token).toBe('doccnABC');
    expect(spy.mock.calls[0]![0].is_whole).toBe(true);
  });

  it('未设回调不抛错', async () => {
    await expect(
      handlers['drive.notice.comment_add_v1']!({ file_token: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('回调异常被吞', async () => {
    callbacks.onDriveCommentAdd = () => {
      throw new Error('biz');
    };
    await expect(
      handlers['drive.notice.comment_add_v1']!({ file_token: 'x' }),
    ).resolves.toBeUndefined();
  });
});

// ─── Phase I-2: Doc/Drive API 封装 ─────────────────────────────────

describe('doc-api', () => {
  it('toTextElements 纯文本转 text_run', () => {
    const elements = toTextElements('你好');
    expect(elements).toEqual([{ type: 'text_run', text_run: { text: '你好' } }]);
  });

  it('addWholeCommentReply 调用 fileComment.create 并回 comment_id', async () => {
    const create = vi.fn().mockResolvedValue({
      code: 0,
      data: { comment_id: 'cm_new' },
    });
    const client = {
      drive: { v1: { fileComment: { create } } },
    } as any;

    const id = await addWholeCommentReply(client, {
      fileToken: 'doccn_1',
      fileType: 'docx',
      text: '机器人回复',
    });
    expect(id).toBe('cm_new');
    const call = create.mock.calls[0][0];
    expect(call.params.file_type).toBe('docx');
    expect(call.path.file_token).toBe('doccn_1');
    expect(call.data.reply_list.replies[0].content.elements[0].text_run.text).toBe(
      '机器人回复',
    );
  });

  it('addWholeCommentReply code 非 0 抛 FeishuApiError', async () => {
    const client = {
      drive: {
        v1: {
          fileComment: {
            create: vi.fn().mockResolvedValue({ code: 1069301, msg: 'locked' }),
          },
        },
      },
    } as any;
    await expect(
      addWholeCommentReply(client, { fileToken: 'x', fileType: 'doc', text: 'y' }),
    ).rejects.toBeInstanceOf(FeishuApiError);
  });

  it('replyToComment 走 client.request 自建 URL', async () => {
    const request = vi.fn().mockResolvedValue({
      code: 0,
      data: { reply_id: 'rp_1' },
    });
    const client = { request, drive: {} } as any;
    const id = await replyToComment(client, {
      fileToken: 'doccn_1',
      commentId: 'cm_1',
      fileType: 'docx',
      text: 'hi',
    });
    expect(id).toBe('rp_1');
    const arg = request.mock.calls[0][0];
    expect(arg.method).toBe('POST');
    expect(arg.url).toContain('/files/doccn_1/comments/cm_1/replies');
    expect(arg.url).toContain('file_type=docx');
  });

  it('listCommentReplies 将 elements 扁平化为 text', async () => {
    const list = vi.fn().mockResolvedValue({
      code: 0,
      data: {
        items: [
          {
            reply_id: 'rp_1',
            user_id: 'ou_u',
            create_time: 1700000000,
            content: {
              elements: [
                { type: 'text_run', text_run: { text: '这里有问题 ' } },
                { type: 'docs_link', docs_link: { url: 'https://x.com' } },
                { type: 'person', person: { user_id: 'ou_mention' } },
              ],
            },
          },
        ],
        has_more: false,
      },
    });
    const client = {
      drive: { v1: { fileCommentReply: { list } } },
    } as any;

    const res = await listCommentReplies(client, {
      fileToken: 'doccn_1',
      commentId: 'cm_1',
      fileType: 'docx',
    });
    expect(res.replies).toHaveLength(1);
    expect(res.replies[0]!.text).toBe('这里有问题 https://x.com@ou_mention');
    expect(res.hasMore).toBe(false);
    expect(res.replies[0]!.reply_id).toBe('rp_1');
  });
});

// ─── Phase J-1: retry 退避 ─────────────────────────────────────────

describe('isRetryableFeishuError', () => {
  it('限流 code 可重试', () => {
    expect(
      isRetryableFeishuError(new FeishuApiError('send', 99991400, 'rate limit')),
    ).toBe(true);
    expect(
      isRetryableFeishuError(new FeishuApiError('send', 99991663, 'too many')),
    ).toBe(true);
  });

  it('参数/权限 code 不重试', () => {
    expect(
      isRetryableFeishuError(new FeishuApiError('send', 230001, 'bad')),
    ).toBe(false);
    expect(
      isRetryableFeishuError(new FeishuApiError('send', 99991664, 'denied')),
    ).toBe(false);
  });

  it('transient 网络错误可重试', () => {
    expect(isRetryableFeishuError(new Error('ECONNRESET'))).toBe(true);
    expect(isRetryableFeishuError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableFeishuError(new Error('HTTP 503 Service Unavailable'))).toBe(true);
    expect(isRetryableFeishuError(new Error('connect ETIMEDOUT'))).toBe(true);
  });

  it('普通业务错误不重试', () => {
    expect(isRetryableFeishuError(new Error('bad argument'))).toBe(false);
    expect(isRetryableFeishuError('string error')).toBe(false);
    expect(isRetryableFeishuError(null)).toBe(false);
  });
});

describe('withFeishuRetry', () => {
  /** 注入 sleep 跳过真实等待 */
  const noSleep = async () => {};

  it('首次成功直接返回', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withFeishuRetry(fn, { sleep: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('限流失败后重试成功', async () => {
    let n = 0;
    const fn = vi.fn().mockImplementation(async () => {
      n += 1;
      if (n < 2) throw new FeishuApiError('send', 99991400, 'rate');
      return 'ok';
    });
    const result = await withFeishuRetry(fn, { sleep: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('3 次都失败最终抛出', async () => {
    const err = new FeishuApiError('send', 99991400, 'rate');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withFeishuRetry(fn, { sleep: noSleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });

  it('不可重试错误首次即抛，不重试', async () => {
    const fn = vi.fn().mockRejectedValue(
      new FeishuApiError('send', 230001, 'bad'),
    );
    await expect(withFeishuRetry(fn, { sleep: noSleep })).rejects.toBeInstanceOf(
      FeishuApiError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('指数退避：delay 依次为 base, 2*base, 4*base', async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => {
      delays.push(ms);
    };
    const fn = vi
      .fn()
      .mockRejectedValue(new FeishuApiError('send', 99991400, 'rate'));
    await expect(
      withFeishuRetry(fn, { sleep, baseDelayMs: 10, maxAttempts: 4 }),
    ).rejects.toBeTruthy();
    expect(delays).toEqual([10, 20, 40]);
  });

  it('自定义 maxAttempts 生效', async () => {
    const fn = vi.fn().mockRejectedValue(
      new FeishuApiError('send', 99991400, 'rate'),
    );
    await expect(
      withFeishuRetry(fn, { sleep: noSleep, maxAttempts: 2 }),
    ).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('默认常量 sanity', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(DEFAULT_BASE_DELAY_MS).toBe(1000);
  });
});
