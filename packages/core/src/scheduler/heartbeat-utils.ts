/**
 * Heartbeat 工具函数 — 空文件检测 + ACK 鲁棒检测
 *
 * 对齐 OpenClaw 的 heartbeat.ts 预检逻辑，减少不必要的 LLM 调用。
 */

const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';

// ─── 空文件检测 ───

/**
 * 检测 HEARTBEAT.md 内容是否"有效为空"
 *
 * "有效为空"指文件仅包含：空行、Markdown 标题、空列表项、HTML 注释。
 * 这类内容不构成可执行任务，跳过 LLM 调用以节省 Token。
 *
 * 注意：文件不存在（null/undefined）返回 false，让 LLM 自行判断。
 */
export function isHeartbeatContentEffectivelyEmpty(
  content: string | undefined | null,
): boolean {
  if (content === null || content === undefined) return false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    if (/^<!--.*-->$/.test(trimmed)) continue;
    return false;
  }
  return true;
}

// ─── ACK 鲁棒检测 ───

/**
 * 剥离 Markdown/HTML 包裹标记
 */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/^[*`~_]+/, '')
    .replace(/[*`~_]+$/, '')
    .trim();
}

/**
 * 检测响应是否为 Heartbeat 空闲确认
 *
 * 支持：
 * - 纯文本: "HEARTBEAT_OK"
 * - Markdown 包裹: "**HEARTBEAT_OK**", "`HEARTBEAT_OK`"
 * - HTML 包裹: "<b>HEARTBEAT_OK</b>"
 * - 尾随标点: "HEARTBEAT_OK.", "HEARTBEAT_OK!"
 * - 附带短文本: "HEARTBEAT_OK，一切正常" (≤ ackMaxChars 时视为空闲)
 * - NO_REPLY → 直接判空闲
 *
 * @param response    LLM 原始响应（已清理 PI 标记）
 * @param ackMaxChars token 剥离后允许的最大剩余字符数（默认 300）
 */
export function detectHeartbeatAck(
  response: string | null | undefined,
  ackMaxChars = 300,
): { isAck: true } | { isAck: false; text: string } {
  if (!response || !response.trim()) return { isAck: true };

  const trimmed = response.trim();

  if (trimmed === 'NO_REPLY') return { isAck: true };

  const normalized = stripMarkup(trimmed);
  const hasToken =
    trimmed.includes(HEARTBEAT_TOKEN) || normalized.includes(HEARTBEAT_TOKEN);

  if (!hasToken) return { isAck: false, text: trimmed };

  const stripped = normalized
    .replace(new RegExp(HEARTBEAT_TOKEN, 'gi'), '')
    .replace(/^[\s.!,;:?，。！；：？\-—]+/, '')
    .replace(/[\s.!,;:?，。！；：？\-—]+$/, '')
    .trim();

  if (stripped.length <= ackMaxChars) {
    return { isAck: true };
  }

  return { isAck: false, text: stripped };
}
