/**
 * 飞书 Post 富文本 → 纯文本转换（入站使用）
 *
 * Post 结构参考 https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message-content/post-content
 * 仅提取可读文本，用于喂给 LLM。
 *
 * Post payload 示例：
 * {
 *   "zh_cn": {
 *     "title": "标题",
 *     "content": [
 *       [
 *         { "tag": "text", "text": "第一行" },
 *         { "tag": "a", "text": "链接", "href": "https://..." }
 *       ],
 *       [
 *         { "tag": "at", "user_id": "..." },
 *         { "tag": "img", "image_key": "img_..." }
 *       ]
 *     ]
 *   }
 * }
 */

/** Post 内嵌元素（节选常见 tag，未知 tag 降级为 JSON 字符串） */
interface PostElement {
  tag: string;
  text?: string;
  href?: string;
  user_id?: string;
  user_name?: string;
  image_key?: string;
  file_key?: string;
  emoji_type?: string;
  line?: number;
  char?: number;
}

type PostRow = PostElement[];

interface PostLanguagePayload {
  title?: string;
  content?: PostRow[];
}

type PostPayload = Record<string, PostLanguagePayload | undefined>;

/**
 * 把 Post JSON（已 parse）转为纯文本，优先挑第一个非空 language
 */
export function postPayloadToText(payload: PostPayload): string {
  const language = pickLanguage(payload);
  if (!language) return '';

  const parts: string[] = [];
  if (language.title) parts.push(language.title);

  const rows = language.content ?? [];
  for (const row of rows) {
    const line = rowToText(row);
    if (line) parts.push(line);
  }
  return parts.join('\n');
}

/**
 * 入口：content 为 JSON 字符串（飞书原样给出），解析并转纯文本；失败降级原样返回
 *
 * 兼容两种飞书给出的 Post 结构：
 * - 语言包装（入站 im.message.receive_v1 事件）：`{zh_cn: {title, content}, en_us: {...}}`
 * - 非语言包装（im.v1.message.get 回查消息）：`{title, content}`（已经是 language payload 本身）
 *
 * 检测方法：如果顶层有 `title` 或 `content` 字段，就当作非语言包装直接渲染；
 * 否则走 pickLanguage 挑选一个语言版本。
 */
export function parsePostContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object') return '';
    const obj = parsed as Record<string, unknown>;

    // 非语言包装：顶层直接带 title / content
    if ('title' in obj || 'content' in obj) {
      return postPayloadToText({ _: obj as PostLanguagePayload });
    }

    return postPayloadToText(obj as PostPayload);
  } catch {
    return content;
  }
}

function pickLanguage(payload: PostPayload): PostLanguagePayload | null {
  // 优先使用中文，其次英文，其次任意存在的 language
  const preferred = ['zh_cn', 'en_us', 'ja_jp', 'zh_hk', 'zh_tw'];
  for (const key of preferred) {
    const v = payload[key];
    if (v && (v.title || (v.content && v.content.length))) return v;
  }
  for (const v of Object.values(payload)) {
    if (v && (v.title || (v.content && v.content.length))) return v;
  }
  return null;
}

function rowToText(row: PostRow): string {
  return row
    .map(elementToText)
    .filter((s): s is string => Boolean(s))
    .join('');
}

function elementToText(el: PostElement): string {
  switch (el.tag) {
    case 'text':
    case 'md':
      return el.text ?? '';
    case 'a':
      // [text](href)，text 缺失则用 href
      if (el.href) return el.text ? `[${el.text}](${el.href})` : el.href;
      return el.text ?? '';
    case 'at':
      return el.user_name ? `@${el.user_name}` : el.user_id ? `@${el.user_id}` : '@?';
    case 'img':
      return el.image_key ? `[图片:${el.image_key}]` : '[图片]';
    case 'media':
      return el.file_key ? `[媒体:${el.file_key}]` : '[媒体]';
    case 'emotion':
      return el.emoji_type ? `[表情:${el.emoji_type}]` : '[表情]';
    case 'code_block':
      return el.text ? '```\n' + el.text + '\n```' : '';
    case 'hr':
      return '---';
    default:
      return '';
  }
}
