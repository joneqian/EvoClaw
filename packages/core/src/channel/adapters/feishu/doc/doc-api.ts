/**
 * 飞书文档 / 云盘 API 薄封装
 *
 * 用于文档评论协作 + agent 文档协作闭环（M13 Phase 5）。
 *
 * 当前提供：
 * - addWholeCommentReply: 整篇文档追加全文评论（fileComment.create）
 * - replyToComment:       已有评论追加回复（raw client.request）
 * - listCommentReplies:   列出某条评论下所有回复
 * - getDocContent:        读取 docx 全文 block 列表 → 扁平化 plainText（C2）
 *
 * 未来扩展：block 创建/编辑/删除（C3/C4）。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import { FeishuApiError } from '../outbound/index.js';

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

// ─── 文档内容读取（M13 Phase 5 C2） ─────────────────────────────────────

/** 文档单 block 的扁平化结构（去掉 SDK 复杂的 type-specific fields） */
export interface DocBlock {
  /** block_id（编辑/删除时用） */
  id: string;
  /**
   * block_type 数字（飞书原生）
   *
   * 常见取值：1 page / 2 text / 3-11 heading 1-9 / 12 bullet / 13 ordered /
   * 14 code / 15 quote / 17 todo。完整列表见飞书 docx 文档。
   */
  type: number;
  /** block 的可读文本（已扁平化 elements，未应用 markdown 格式）*/
  text: string;
  /** 父 block id（构建块树用，v1 工具不暴露但保留供 C3/C4 复用）*/
  parentId?: string;
}

/** 一份文档的内容快照 */
export interface DocContentSnapshot {
  /** documentId（docx 场景下等价 fileToken） */
  documentId: string;
  /** 块列表（按文档顺序）*/
  blocks: DocBlock[];
  /**
   * 全文扁平化 plainText（每个 block 一行，跳过空文本块）
   *
   * agent 直接消费这个字段；如需结构化处理可遍历 blocks
   */
  plainText: string;
}

/** docx block 单页列表的 SDK 响应字段子集（与官方 OpenAPI 对齐） */
interface RawDocBlock {
  block_id?: string;
  block_type?: number;
  parent_id?: string;
  text?: { elements?: RawDocTextElement[] };
  // heading/code/quote/etc 都用同一形状的 elements，这里用 index signature 统一处理
  [extraKey: string]: unknown;
}

interface RawDocTextElement {
  text_run?: { content?: string };
  mention_user?: { user_id?: string };
  mention_doc?: { url?: string };
}

/**
 * 从一个 raw block 中抽出可读文本
 *
 * 飞书 docx block 的 elements 字段名因 block_type 而异（text/heading1/code/...），
 * 这里枚举常见 key 取首个非空，简化为 plain text。
 */
function extractBlockText(raw: RawDocBlock): string {
  const candidateKeys = [
    'text',
    'heading1',
    'heading2',
    'heading3',
    'heading4',
    'heading5',
    'heading6',
    'heading7',
    'heading8',
    'heading9',
    'bullet',
    'ordered',
    'code',
    'quote',
    'todo',
    'callout',
  ];
  for (const key of candidateKeys) {
    const node = raw[key] as { elements?: RawDocTextElement[] } | undefined;
    if (!node?.elements) continue;
    const text = node.elements
      .map((el) => {
        if (el.text_run?.content) return el.text_run.content;
        if (el.mention_user?.user_id) return `<user:${el.mention_user.user_id}>`;
        if (el.mention_doc?.url) return el.mention_doc.url;
        return '';
      })
      .join('');
    if (text) return text;
  }
  return '';
}

/**
 * 读取 docx 全文内容
 *
 * 行为：
 * - 当前**只支持 docx**（其它 file_type 抛错；M13 v1 范围）
 * - 自动分页：单页 500，循环到 has_more=false
 * - 返回扁平化 plainText（每 block 一行）+ 结构化 blocks 数组（C3/C4 编辑会用）
 *
 * 错误处理：飞书业务码 → FeishuApiError；网络/SDK 错误正常抛出
 */
export async function getDocContent(
  client: Lark.Client,
  params: {
    fileToken: string;
    fileType: FeishuFileType;
  },
): Promise<DocContentSnapshot> {
  if (params.fileType !== 'docx') {
    throw new Error(`getDocContent 当前只支持 docx，收到 ${params.fileType}`);
  }
  const documentId = params.fileToken;
  const blocks: DocBlock[] = [];
  let pageToken: string | undefined;

  do {
    const url =
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?page_size=500` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
    const res = (await client.request({
      url,
      method: 'GET',
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: RawDocBlock[];
        page_token?: string;
        has_more?: boolean;
      };
    };
    if (res.code) {
      throw new FeishuApiError('读取文档内容', res.code, res.msg ?? '');
    }
    for (const item of res.data?.items ?? []) {
      blocks.push({
        id: item.block_id ?? '',
        type: item.block_type ?? 0,
        text: extractBlockText(item),
        ...(item.parent_id ? { parentId: item.parent_id } : {}),
      });
    }
    pageToken = res.data?.has_more ? res.data?.page_token : undefined;
  } while (pageToken);

  const plainText = blocks
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join('\n');

  return { documentId, blocks, plainText };
}

// ─── 块创建（M13 Phase 5 C3） ──────────────────────────────────────────

/**
 * 在 docx 末尾或某 block 下追加一个文本块
 *
 * 行为：
 * - 调 `POST /open-apis/docx/v1/documents/:document_id/blocks/:block_id/children`
 *   把新 block 作为 `parentBlockId`（默认=doc 根）的最后一个 child
 * - block_type=2（飞书 text 块）+ 单 text_run 元素，避免暴露 SDK 复杂 schema
 * - 可选 `documentRevisionId` 乐观锁：传入后服务端校验文档版本，过期则 230108
 *   错（agent 可重新 read_doc 后重试）
 *
 * 错误处理：
 * - 230108（document_revision_id 过期）/ 230109（block 不存在）走 FeishuApiError
 *   通道，agent 的 catch 路径决定是否重读 + 重试（不在工具层自动重试，避免覆盖
 *   并发用户编辑）
 *
 * @returns 新建 block 的 block_id；data 缺失时返回 null
 */
export async function appendTextBlock(
  client: Lark.Client,
  params: {
    fileToken: string;
    fileType: FeishuFileType;
    /** 父 block_id，默认等于 fileToken（即 docx 根） */
    parentBlockId?: string;
    /** 要追加的文本内容（纯文本，单 text_run） */
    text: string;
    /**
     * 文档版本号（乐观锁）
     *
     * 不传时服务端不做版本校验；传入则校验，过期 → 230108。建议从前一次
     * `getDocContent` 或 `appendTextBlock` 的响应中取值。
     */
    documentRevisionId?: number;
  },
): Promise<{ blockId: string | null; revisionId: number | null }> {
  if (params.fileType !== 'docx') {
    throw new Error(`appendTextBlock 当前只支持 docx，收到 ${params.fileType}`);
  }
  const documentId = encodeURIComponent(params.fileToken);
  const parentBlockId = encodeURIComponent(params.parentBlockId ?? params.fileToken);
  const query =
    params.documentRevisionId !== undefined
      ? `?document_revision_id=${encodeURIComponent(String(params.documentRevisionId))}`
      : '';

  const res = (await client.request({
    url: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentBlockId}/children${query}`,
    method: 'POST',
    data: {
      children: [
        {
          block_type: 2, // text block
          text: {
            elements: [{ text_run: { content: params.text } }],
          },
        },
      ],
    },
  })) as {
    code?: number;
    msg?: string;
    data?: {
      children?: Array<{ block_id?: string }>;
      document_revision_id?: number;
    };
  };

  if (res.code) {
    throw new FeishuApiError('追加文本块', res.code, res.msg ?? '');
  }
  return {
    blockId: res.data?.children?.[0]?.block_id ?? null,
    revisionId: res.data?.document_revision_id ?? null,
  };
}

// ─── 块替换 / 删除（M13 Phase 5 C4） ──────────────────────────────────

/**
 * 替换块的文本内容（仅文本类块：text / heading1-9 / code / bullet / ordered /
 * quote / todo / callout 等）
 *
 * - 调 PATCH /open-apis/docx/v1/documents/:doc/blocks/:block_id
 * - 用 update_text_elements 字段（飞书在 SDK 路径走 patch.replace_text，REST 路径
 *   则是把整个 block 的 text.elements 替换）
 * - 230108（version 过期）/ 230109（block 不存在）走 FeishuApiError，不在 doc-api
 *   层重试 — 由 agent 决定是否重读 + 重试
 *
 * 限制：v1 不支持非文本块（image / table / divider / file），调用方需先用
 * getDocContent 获取 block_type 判定。
 */
export async function replaceBlockText(
  client: Lark.Client,
  params: {
    fileToken: string;
    fileType: FeishuFileType;
    blockId: string;
    text: string;
    documentRevisionId?: number;
  },
): Promise<{ revisionId: number | null }> {
  if (params.fileType !== 'docx') {
    throw new Error(`replaceBlockText 当前只支持 docx，收到 ${params.fileType}`);
  }
  const documentId = encodeURIComponent(params.fileToken);
  const blockId = encodeURIComponent(params.blockId);
  const query =
    params.documentRevisionId !== undefined
      ? `?document_revision_id=${encodeURIComponent(String(params.documentRevisionId))}`
      : '';

  const res = (await client.request({
    url: `/open-apis/docx/v1/documents/${documentId}/blocks/${blockId}${query}`,
    method: 'PATCH',
    data: {
      update_text_elements: {
        elements: [{ text_run: { content: params.text } }],
      },
    },
  })) as {
    code?: number;
    msg?: string;
    data?: { document_revision_id?: number };
  };

  if (res.code) {
    throw new FeishuApiError('替换块文本', res.code, res.msg ?? '');
  }
  return { revisionId: res.data?.document_revision_id ?? null };
}

/**
 * 删除指定 block
 *
 * 飞书 API 路径用 parent + index：
 *   POST /open-apis/docx/v1/documents/:doc/blocks/:parent_block_id/children/batch_delete
 *   body: { start_index, end_index }  // 删除 [start, end) 区间
 *
 * 本封装让调用方只关心 blockId：内部会读一次 doc 查 parent + index，再发 delete。
 * 牺牲 1 次 API 调用换 agent 简单（agent 拿到 block_id 就能删）。
 *
 * 230108 不在层内重试（同 replace）。
 */
export async function deleteBlock(
  client: Lark.Client,
  params: {
    fileToken: string;
    fileType: FeishuFileType;
    blockId: string;
    documentRevisionId?: number;
  },
): Promise<{ revisionId: number | null; deletedText: string }> {
  if (params.fileType !== 'docx') {
    throw new Error(`deleteBlock 当前只支持 docx，收到 ${params.fileType}`);
  }

  // 1. 读 doc 查 parent + index
  const snapshot = await getDocContent(client, {
    fileToken: params.fileToken,
    fileType: params.fileType,
  });
  const targetIdx = snapshot.blocks.findIndex((b) => b.id === params.blockId);
  if (targetIdx < 0) {
    throw new Error(`deleteBlock 找不到 block_id=${params.blockId}`);
  }
  const target = snapshot.blocks[targetIdx]!;
  const parentBlockId = target.parentId ?? params.fileToken;
  // siblings = 同 parent 下的所有 block，按文档顺序（API 已排序）
  const siblings = snapshot.blocks.filter((b) => (b.parentId ?? params.fileToken) === parentBlockId);
  const indexInParent = siblings.findIndex((b) => b.id === params.blockId);
  if (indexInParent < 0) {
    throw new Error(`deleteBlock 在 parent=${parentBlockId} 下找不到 block_id=${params.blockId}`);
  }

  // 2. 调 batch_delete
  const documentId = encodeURIComponent(params.fileToken);
  const parentEnc = encodeURIComponent(parentBlockId);
  const query =
    params.documentRevisionId !== undefined
      ? `?document_revision_id=${encodeURIComponent(String(params.documentRevisionId))}`
      : '';
  const res = (await client.request({
    url: `/open-apis/docx/v1/documents/${documentId}/blocks/${parentEnc}/children/batch_delete${query}`,
    method: 'DELETE',
    data: {
      start_index: indexInParent,
      end_index: indexInParent + 1,
    },
  })) as {
    code?: number;
    msg?: string;
    data?: { document_revision_id?: number };
  };

  if (res.code) {
    throw new FeishuApiError('删除块', res.code, res.msg ?? '');
  }
  return {
    revisionId: res.data?.document_revision_id ?? null,
    deletedText: target.text,
  };
}
