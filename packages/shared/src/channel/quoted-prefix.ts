/**
 * 引用消息文本前缀 —— 前后端共享的格式约定
 *
 * 目的：ChannelMessage.quoted 是结构化字段，但 Agent / DB / UI 都只消费一段字符串。
 * 这里用固定 XML 标签把引用信息嵌到 message content 头部：
 *
 *   <quoted_message id="om_xxx" sender="ou_yyy" from="龙虾-CEO" ts="1714...">
 *   被引用的正文（已做 HTML 转义）
 *   </quoted_message>
 *
 *   用户真实输入的内容
 *
 * - Agent 一眼能看懂这是引用的上下文
 * - DB 原样存储 → history 自动带上引用
 * - 前端 MessageBubble 用同一个 parseQuotedPrefix 提取后单独渲染
 *
 * 格式约定故意保守：属性值用双引号包裹 + 转义；正文 HTML 转义一遍，避免闭合
 * 标签被用户输入的 </quoted_message> 污染，解析时再反转义。
 */
import type { QuotedMessage } from '../types/channel.js';

/** 仅当 content 开头是 `<quoted_message ` 时才尝试解析，其他情况短路 */
export const QUOTED_MESSAGE_OPEN_RE = /^<quoted_message\s/;

const QUOTED_MESSAGE_FULL_RE =
  /^<quoted_message([^>]*)>\n([\s\S]*?)\n<\/quoted_message>\n\n/;

/**
 * 把引用信息拼到 message 前缀。quoted 为空时原样返回。
 */
export function composeMessageWithQuote(
  message: string,
  quoted?: QuotedMessage,
): string {
  if (!quoted) return message;

  const attrs = [
    `id="${escapeAttr(quoted.messageId)}"`,
    `sender="${escapeAttr(quoted.senderId)}"`,
    `from="${escapeAttr(quoted.senderName ?? quoted.senderId)}"`,
  ];
  if (quoted.timestamp !== undefined) {
    attrs.push(`ts="${quoted.timestamp}"`);
  }

  return (
    `<quoted_message ${attrs.join(' ')}>\n` +
    `${escapeBody(quoted.content)}\n` +
    `</quoted_message>\n\n` +
    message
  );
}

/**
 * 从 message 头部提取引用前缀。无前缀时 quoted=undefined，rest=原文。
 *
 * 解析失败（标签损坏 / 没闭合）时也安全降级为 rest=原文。
 */
export function parseQuotedPrefix(content: string): {
  quoted?: QuotedMessage;
  rest: string;
} {
  if (!QUOTED_MESSAGE_OPEN_RE.test(content)) {
    return { rest: content };
  }
  const match = QUOTED_MESSAGE_FULL_RE.exec(content);
  if (!match) {
    return { rest: content };
  }
  const attrStr = match[1] ?? '';
  const body = match[2] ?? '';
  const rest = content.slice(match[0].length);

  const id = readAttr(attrStr, 'id');
  if (!id) return { rest: content };

  const quoted: QuotedMessage = {
    messageId: id,
    senderId: readAttr(attrStr, 'sender') ?? '',
    content: unescapeBody(body),
  };
  const from = readAttr(attrStr, 'from');
  if (from) quoted.senderName = from;
  const tsRaw = readAttr(attrStr, 'ts');
  if (tsRaw) {
    const ts = Number(tsRaw);
    if (Number.isFinite(ts)) quoted.timestamp = ts;
  }
  return { quoted, rest };
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
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeBody(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function readAttr(attrStr: string, name: string): string | null {
  const re = new RegExp(`\\b${name}="([^"]*)"`);
  const m = re.exec(attrStr);
  return m ? unescapeBody(m[1] ?? '') : null;
}
