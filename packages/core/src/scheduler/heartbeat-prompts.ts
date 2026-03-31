/**
 * Heartbeat 提示词模块
 *
 * 根据触发原因（定时/cron/exec/手动唤醒）生成不同的 LLM prompt。
 * 对齐 OpenClaw 的 reason-based prompt 切换体系。
 */

export const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';

/** 触发原因 */
export type HeartbeatReason =
  | 'interval'      // 定时触发
  | 'wake'          // 手动唤醒
  | 'cron-event'    // Cron 事件
  | 'exec-event';   // 异步命令完成

/** Prompt 构建选项 */
export interface HeartbeatPromptOptions {
  reason: HeartbeatReason;
  /** 自定义 prompt 覆盖（用户配置） */
  customPrompt?: string;
  /** 当前时间 ISO 字符串 */
  currentTime: string;
  /** Cron 事件文本（reason=cron-event 时使用） */
  cronEventTexts?: string[];
  /** 是否投递给用户（影响 cron/exec prompt 措辞） */
  deliverToUser?: boolean;
}

/**
 * 构建 Heartbeat prompt
 *
 * 策略：
 * 1. exec-event → 异步命令完成 prompt
 * 2. cron-event → 定时提醒 prompt（区分投递/内部处理）
 * 3. interval/wake → 标准 heartbeat prompt（支持自定义覆盖）
 */
export function buildHeartbeatPrompt(opts: HeartbeatPromptOptions): string {
  switch (opts.reason) {
    case 'exec-event':
      return buildExecEventPrompt(opts.deliverToUser ?? false);

    case 'cron-event':
      return buildCronEventPrompt(
        opts.cronEventTexts ?? [],
        opts.deliverToUser ?? false,
      );

    case 'interval':
    case 'wake':
    default:
      return resolveStandardPrompt(opts);
  }
}

// ─── 标准 Heartbeat Prompt ───

const DEFAULT_HEARTBEAT_PROMPT =
  `Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. ` +
  `Do not infer or repeat old tasks from prior chats. ` +
  `If nothing needs attention, reply ${HEARTBEAT_TOKEN}.`;

function resolveStandardPrompt(opts: HeartbeatPromptOptions): string {
  const base = opts.customPrompt?.trim() || DEFAULT_HEARTBEAT_PROMPT;
  return `[Heartbeat] Current time: ${opts.currentTime}\n${base}`;
}

// ─── Cron Event Prompt ───

function buildCronEventPrompt(
  eventTexts: string[],
  deliverToUser: boolean,
): string {
  const content = eventTexts.filter(Boolean).join('\n');

  if (!content) {
    return deliverToUser
      ? `A scheduled cron event was triggered, but no event content was found. Reply ${HEARTBEAT_TOKEN}.`
      : `A scheduled cron event was triggered, but no event content was found. Handle this internally and reply ${HEARTBEAT_TOKEN} when nothing needs user-facing follow-up.`;
  }

  const instruction = deliverToUser
    ? 'Please relay this reminder to the user in a helpful and friendly way.'
    : 'Handle this reminder internally. Do not relay it to the user unless explicitly requested.';

  return (
    `A scheduled reminder has been triggered. The reminder content is:\n\n` +
    `${content}\n\n` +
    `${instruction}`
  );
}

// ─── Exec Event Prompt ───

function buildExecEventPrompt(deliverToUser: boolean): string {
  return deliverToUser
    ? `An async command you ran earlier has completed. The result is shown in the system messages above. Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. If it failed, explain what went wrong.`
    : `An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.`;
}
