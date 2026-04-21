/**
 * 飞书文档 / 云盘 API 薄封装
 *
 * 用于文档评论协作（drive.notice.comment_add_v1 触发后，由上层调度 agent 生成
 * 回复，再通过这里发回飞书）。
 *
 * 只做两件事：
 * - addWholeCommentReply: 对整篇文档追加一条全文评论（fileComment.create）
 * - replyToComment:       对已有评论追加回复（SDK 未强类型，走 client.request）
 *
 * 更丰富的读取/遍历在未来接入 agent协作闭环时再加，当前保持最小表面积。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { FeishuApiError } from './outbound.js';

/** 飞书富文本评论元素 */
export type CommentElement =
  | { type: 'text_run'; text_run: { text: string } }
  | { type: 'docs_link'; docs_link: { url: string } }
  | { type: 'person'; person: { user_id: string } };

/** 文档类型（飞书支持评论的文档类型枚举子集，与 event-handlers 保持一致） */
export type FeishuFileType = 'doc' | 'docx' | 'sheet' | 'file' | 'slides';

/** 运行时白名单：SDK 类型只是编译时 hint，飞书事件可能推 bitable / mindnote 等扩展值 */
const SUPPORTED_FILE_TYPES = new Set<FeishuFileType>(['doc', 'docx', 'sheet', 'file', 'slides']);

function assertFileType(fileType: string, action: string): asserts fileType is FeishuFileType {
  if (!SUPPORTED_FILE_TYPES.has(fileType as FeishuFileType)) {
    throw new Error(`${action} 不支持的 file_type: ${fileType}`);
  }
}

/** 把一段纯文本转为单 text_run 元素 */
export function toTextElements(text: string): CommentElement[] {
  return [{ type: 'text_run', text_run: { text } }];
}

/**
 * 对整篇文档追加一条"全文评论"（不附着在文档某块上）
 *
 * SDK API: `drive.v1.fileComment.create`
 * @returns 新建评论 id（可能为空）
 */
export async function addWholeCommentReply(
  client: Lark.Client,
  params: {
    fileToken: string;
    fileType: 'doc' | 'docx';
    text: string;
  },
): Promise<string | null> {
  const res = await client.drive.v1.fileComment.create({
    params: { file_type: params.fileType },
    path: { file_token: params.fileToken },
    data: {
      reply_list: {
        replies: [
          {
            content: { elements: toTextElements(params.text) },
          },
        ],
      },
    },
  });
  if (res.code) {
    throw new FeishuApiError('添加全文评论', res.code, res.msg ?? '');
  }
  return res.data?.comment_id ?? null;
}

/**
 * 对已有评论 thread 追加一条回复
 *
 * SDK 没有 wrapper，直接走 raw request：
 *   POST /open-apis/drive/v1/files/:file_token/comments/:comment_id/replies
 */
export async function replyToComment(
  client: Lark.Client,
  params: {
    fileToken: string;
    commentId: string;
    fileType: FeishuFileType;
    text: string;
  },
): Promise<string | null> {
  assertFileType(params.fileType, '回复文档评论');
  // fileToken / commentId 来自 drive 事件推送，属外部输入，必须 URL 编码防跨路径 / query 注入
  const ft = encodeURIComponent(params.fileToken);
  const cid = encodeURIComponent(params.commentId);
  const ftype = encodeURIComponent(params.fileType);
  const res = (await client.request({
    url: `/open-apis/drive/v1/files/${ft}/comments/${cid}/replies?file_type=${ftype}`,
    method: 'POST',
    data: {
      content: { elements: toTextElements(params.text) },
    },
  })) as {
    code?: number;
    msg?: string;
    data?: { reply_id?: string };
  };
  if (res.code) {
    throw new FeishuApiError('回复文档评论', res.code, res.msg ?? '');
  }
  return res.data?.reply_id ?? null;
}

/**
 * 列出某条评论下的所有回复（用于 agent 组 prompt 时展示评论 timeline）
 *
 * SDK API: `drive.v1.fileCommentReply.list`
 */
export async function listCommentReplies(
  client: Lark.Client,
  params: {
    fileToken: string;
    commentId: string;
    fileType: FeishuFileType;
    pageSize?: number;
    pageToken?: string;
  },
): Promise<{
  replies: Array<{ reply_id?: string; user_id?: string; text: string; createTime?: number }>;
  hasMore: boolean;
  nextPageToken?: string;
}> {
  const res = await client.drive.v1.fileCommentReply.list({
    params: {
      file_type: params.fileType,
      ...(params.pageSize ? { page_size: params.pageSize } : {}),
      ...(params.pageToken ? { page_token: params.pageToken } : {}),
    },
    path: {
      file_token: params.fileToken,
      comment_id: params.commentId,
    },
  });
  if (res.code) {
    throw new FeishuApiError('列出评论回复', res.code, res.msg ?? '');
  }
  const items = res.data?.items ?? [];
  const replies = items.map((item) => {
    const text = (item.content.elements ?? [])
      .map((el) =>
        el.type === 'text_run'
          ? el.text_run?.text ?? ''
          : el.type === 'docs_link'
          ? el.docs_link?.url ?? ''
          : el.type === 'person'
          // 用 <user:id> 前缀让 LLM 明确识别这是用户引用而非字面文本
          ? `<user:${el.person?.user_id ?? '?'}>`
          : '',
      )
      .join('');
    const base: { reply_id?: string; user_id?: string; text: string; createTime?: number } = { text };
    if (item.reply_id !== undefined) base.reply_id = item.reply_id;
    if (item.user_id !== undefined) base.user_id = item.user_id;
    if (item.create_time !== undefined) base.createTime = item.create_time;
    return base;
  });
  const result: {
    replies: typeof replies;
    hasMore: boolean;
    nextPageToken?: string;
  } = {
    replies,
    hasMore: res.data?.has_more ?? false,
  };
  if (res.data?.page_token) result.nextPageToken = res.data.page_token;
  return result;
}
