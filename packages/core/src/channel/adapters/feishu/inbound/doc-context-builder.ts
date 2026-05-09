/**
 * M13 Phase 5: 飞书文档评论 → user message 上下文前缀构建
 *
 * 触发：channel-message-handler 收到 ChannelMessage.feishuDoc 字段时调用本模块
 * 把上下文以 XML 块拼到 user message 前部，让 LLM 知道：
 *   1. 当前消息来自哪份文档（fileToken）的哪条评论（commentId / replyId）
 *   2. 该评论 thread 里其他人最近 N 条回复（comment timeline，避免突兀回复）
 *
 * 设计取舍（详见 docs/iteration-plans/M13-Phase5-Plan.md §1）:
 *   - 不预加载文档全文：让 agent 用 feishu_read_doc 工具按需读，避免 token 爆炸
 *   - timeline 默认 5 条：thread 上下文充分 + 不污染主 prompt
 *   - 拉取失败 silent fallback：返回最小 context block（只有 fileToken 等结构化字段）
 *     不阻塞主流程；agent 仍能用 read_doc + list_comment_replies 工具补救
 */

import type { FeishuDocContext } from '@evoclaw/shared';
import type { FeishuAdapter } from '../index.js';
import type { FeishuFileType } from '../doc/doc-api.js';
import { createLogger } from '../../../../infrastructure/logger.js';

const log = createLogger('feishu-doc-context-builder');

const DEFAULT_MAX_TIMELINE_REPLIES = 5;
const TIMELINE_TEXT_TRUNCATE = 200;

export interface BuildDocContextOptions {
  /** Timeline 最多展示几条回复（默认 5） */
  maxTimelineReplies?: number;
  /** true 时跳过 timeline 拉取（测试 / 性能场景） */
  skipTimeline?: boolean;
}

export interface BuildDocContextDeps {
  /** 用于调 listCommentReplies；undefined 时跳过 timeline 拉取 */
  feishuAdapter?: FeishuAdapter;
}

/**
 * 把 FeishuDocContext + comment timeline 拼成 XML 上下文前缀。
 *
 * 返回示例（thread 内评论 + 3 条 timeline）：
 *   <feishu_doc_context>
 *     <file token="doccnxxx" type="docx" />
 *     <comment id="cmt001" reply_id="reply002" is_whole="false" />
 *   </feishu_doc_context>
 *   <comment_timeline>
 *     <reply user="ou_aaa" at="2026-05-09T10:00">前面有人提议用 markdown 输出</reply>
 *     <reply user="ou_bbb" at="2026-05-09T10:05">支持 +1</reply>
 *   </comment_timeline>
 *
 * 永不抛异常 — 失败时降级为 context block（无 timeline）。
 */
export async function buildFeishuDocContextPrefix(
  feishuDoc: FeishuDocContext,
  deps: BuildDocContextDeps = {},
  options: BuildDocContextOptions = {},
): Promise<string> {
  const baseContext = renderContextBlock(feishuDoc);

  // 跳过 timeline（无 adapter / skipTimeline=true / 全文评论 thread 不存在 timeline 概念）
  if (options.skipTimeline || !deps.feishuAdapter) {
    return baseContext;
  }

  const maxReplies = options.maxTimelineReplies ?? DEFAULT_MAX_TIMELINE_REPLIES;

  try {
    const result = await deps.feishuAdapter.listCommentReplies({
      fileToken: feishuDoc.fileToken,
      commentId: feishuDoc.commentId,
      fileType: feishuDoc.fileType as FeishuFileType,
      pageSize: maxReplies,
    });
    if (!result.replies.length) {
      return baseContext;
    }
    return baseContext + '\n' + renderTimelineBlock(result.replies, maxReplies);
  } catch (err) {
    // silent fallback — agent 仍可用 list_comment_replies 工具自助拉取
    log.warn(`buildFeishuDocContextPrefix 拉取 timeline 失败: ${err instanceof Error ? err.message : String(err)}`, {
      fileToken: feishuDoc.fileToken,
      commentId: feishuDoc.commentId,
    });
    return baseContext;
  }
}

function renderContextBlock(feishuDoc: FeishuDocContext): string {
  const replyAttr = feishuDoc.replyId ? ` reply_id="${escapeAttr(feishuDoc.replyId)}"` : '';
  return [
    '<feishu_doc_context>',
    `  <file token="${escapeAttr(feishuDoc.fileToken)}" type="${escapeAttr(feishuDoc.fileType)}" />`,
    `  <comment id="${escapeAttr(feishuDoc.commentId)}"${replyAttr} is_whole="${feishuDoc.isWhole}" />`,
    '</feishu_doc_context>',
  ].join('\n');
}

interface TimelineReply {
  reply_id?: string;
  user_id?: string;
  text: string;
  createTime?: number;
}

function renderTimelineBlock(replies: TimelineReply[], max: number): string {
  // 取最近 max 条（飞书 API 默认按时间倒序？保守起见我们排序）
  const sorted = [...replies].sort((a, b) => (a.createTime ?? 0) - (b.createTime ?? 0));
  const recent = sorted.slice(-max);

  const lines = recent.map((r) => {
    const userAttr = r.user_id ? ` user="${escapeAttr(r.user_id)}"` : '';
    const timeAttr = r.createTime ? ` at="${formatTimestamp(r.createTime)}"` : '';
    const truncated = r.text.length > TIMELINE_TEXT_TRUNCATE
      ? r.text.slice(0, TIMELINE_TEXT_TRUNCATE) + '…'
      : r.text;
    return `  <reply${userAttr}${timeAttr}>${escapeBody(truncated)}</reply>`;
  });

  return ['<comment_timeline>', ...lines, '</comment_timeline>'].join('\n');
}

function formatTimestamp(unixSeconds: number): string {
  // 飞书 createTime 是 unix seconds（部分场景毫秒，>10^12 时按毫秒）
  const ms = unixSeconds > 1e12 ? unixSeconds : unixSeconds * 1000;
  return new Date(ms).toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeBody(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
