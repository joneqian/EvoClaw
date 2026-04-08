/**
 * Task Notifications — 任务完成通知格式化 + 注入
 *
 * 将任务完成事件格式化为 <task-notification> XML 文本，
 * 通过 enqueueSystemEvent 入队，让 LLM 下一次 turn 感知到后台任务状态。
 *
 * 参考 Claude Code 的 <task-notification> schema（简化版）。
 */

import { enqueueSystemEvent } from './system-events.js';

/** 通知的业务类型 */
export type TaskNotificationKind = 'subagent' | 'cron' | 'heartbeat' | 'background_process';

/** 通知的终态 */
export type TaskNotificationStatus = 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface TaskNotificationPayload {
  taskId: string;
  kind: TaskNotificationKind;
  status: TaskNotificationStatus;
  /** 任务的人类可读标题（如子 Agent 的 task 参数，或 cron 的 label） */
  title: string;
  /** 结果文本（Markdown / 纯文本），可为空 */
  result?: string;
  /** 错误信息（failed / timed_out 时填） */
  error?: string;
  durationMs: number;
  /** token 用量（仅 subagent / heartbeat 有） */
  tokenUsage?: { inputTokens: number; outputTokens: number };
  /** agentType（子 Agent 专用） */
  agentType?: string;
}

/** 单条结果最大注入长度（超出截断，完整结果可通过工具按需拿） */
const MAX_RESULT_INJECT_CHARS = 800;
const MAX_ERROR_INJECT_CHARS = 400;

/** 格式化为 XML 文本 */
export function formatTaskNotification(p: TaskNotificationPayload): string {
  const lines: string[] = [];
  lines.push('<task-notification>');
  lines.push(`  <task-id>${escapeXml(p.taskId)}</task-id>`);
  lines.push(`  <kind>${p.kind}</kind>`);
  lines.push(`  <status>${p.status}</status>`);
  lines.push(`  <title>${escapeXml(p.title)}</title>`);
  if (p.agentType) lines.push(`  <agent-type>${escapeXml(p.agentType)}</agent-type>`);
  lines.push(`  <duration-ms>${Math.max(0, Math.round(p.durationMs))}</duration-ms>`);
  if (p.tokenUsage) {
    lines.push(`  <tokens input="${p.tokenUsage.inputTokens}" output="${p.tokenUsage.outputTokens}" />`);
  }
  if (p.error) {
    lines.push(`  <error>${escapeXml(truncate(p.error, MAX_ERROR_INJECT_CHARS))}</error>`);
  }
  if (p.result) {
    const { text, truncated } = truncateWithFlag(p.result, MAX_RESULT_INJECT_CHARS);
    lines.push(`  <result${truncated ? ' truncated="true"' : ''}>${escapeXml(text)}</result>`);
  }
  lines.push('</task-notification>');
  return lines.join('\n');
}

/**
 * 入队一条任务完成通知（供所有 runtime 调用）
 *
 * 通过 enqueueSystemEvent 的 contextKey 幂等：同一 taskId 重复入队会覆盖前次。
 * 下一次 user turn 时会由 drainFormattedSystemEvents 自动消费并注入到 LLM 输入前缀。
 */
export function enqueueTaskNotification(
  payload: TaskNotificationPayload,
  sessionKey: string,
): void {
  if (!sessionKey) return;
  const text = formatTaskNotification(payload);
  enqueueSystemEvent(text, sessionKey, {
    contextKey: `task-notification:${payload.taskId}`,
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function truncateWithFlag(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return { text: s.slice(0, max) + '…', truncated: true };
}
