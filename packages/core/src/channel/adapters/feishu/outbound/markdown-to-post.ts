/**
 * Markdown → 飞书 Post 富文本转换（出站使用）
 *
 * 参考 Hermes `_build_markdown_post_payload`：以"代码围栏为块边界"的分段策略，
 * 行内支持 bold / italic / code / link，列表和引用保留 Markdown 符号。
 *
 * 设计取舍：
 * - 不做完整 Markdown 解析（CommonMark 太重），只覆盖 Agent 常见输出格式
 * - 无法表达的元素（表格、图片、HTML）降级为纯文本行
 * - 调用方应包裹 try/catch，失败时降级为 msg_type=text
 */

/** Post 元素（对应 post-to-text 的 PostElement 子集） */
export interface PostBuilderElement {
  tag: 'text' | 'a' | 'code_block' | 'md' | 'at';
  text?: string;
  href?: string;
  /** at 元素：被 @ 用户 / bot 的 open_id；'all' = @所有人（飞书规范） */
  user_id?: string;
  /** 飞书 Post 支持：'bold' / 'italic' / 'underline' / 'lineThrough' */
  style?: Array<'bold' | 'italic' | 'underline' | 'lineThrough'>;
}

type PostBuilderRow = PostBuilderElement[];

export interface PostBuilderPayload {
  zh_cn: {
    title?: string;
    content: PostBuilderRow[];
  };
}

const CODE_FENCE = /^```([\w+-]*)\s*$/;

/** 判断字符串是否"看起来像 Markdown"，不确定时也当成 Markdown 走富文本
 *
 * 含 `<at user_id="..."/>` 也走 markdown 路径，否则被当作纯文本发出去会失去真·@ 效果
 */
const MARKDOWN_HINT_RE = /(\*\*|__|`|~~|^\s*[-*+]\s|^\s*\d+\.\s|^\s*#{1,6}\s|^\s*>|\[[^\]]+\]\(|<at\s+user_id\s*=)/m;

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT_RE.test(text);
}

/**
 * 把 Markdown 文本构造成飞书 Post payload（顶层只用 zh_cn language）
 */
export function buildPostPayload(markdown: string, title?: string): PostBuilderPayload {
  const rows: PostBuilderRow[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(CODE_FENCE);

    if (fence) {
      // 进入代码块，收集直至闭合围栏（或到 EOF）
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !CODE_FENCE.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1; // 跳过闭合围栏
      rows.push([{ tag: 'code_block', text: codeLines.join('\n') }]);
      continue;
    }

    rows.push(lineToRow(line));
    i += 1;
  }

  const payload: PostBuilderPayload = {
    zh_cn: {
      content: rows,
    },
  };
  if (title) payload.zh_cn.title = title;
  return payload;
}

/** 单行 Markdown → Post 行（内嵌元素） */
function lineToRow(line: string): PostBuilderRow {
  const tokens = parseInlineMarkdown(line);
  return tokens;
}

/**
 * 行内 Markdown 解析：支持链接 [text](url)、bold、italic、code
 *
 * 简化策略：先切链接，再对每段切 inline code，再做 bold/italic。
 * 失败降级为纯文本片段。
 */
function parseInlineMarkdown(line: string): PostBuilderRow {
  if (!line) return [{ tag: 'text', text: '' }];

  const out: PostBuilderRow = [];
  // 先识别飞书 at 元素：<at user_id="ou_xxx"/> 或 <at user_id="ou_xxx"></at>
  // user_id="all" 表示 @所有人
  // 必须先于链接解析，避免被当成纯文本带过去
  const atRe = /<at\s+user_id\s*=\s*"([^"]+)"\s*\/?>(?:<\/at>)?/g;
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIdx = 0;

  // 收集所有 at 和 link 的 match，按位置排序统一处理
  type Marker =
    | { kind: 'at'; start: number; end: number; userId: string }
    | { kind: 'link'; start: number; end: number; text: string; href: string };
  const markers: Marker[] = [];
  let m: RegExpExecArray | null;
  while ((m = atRe.exec(line)) !== null) {
    markers.push({ kind: 'at', start: m.index, end: m.index + m[0].length, userId: m[1]! });
  }
  while ((m = linkRe.exec(line)) !== null) {
    markers.push({ kind: 'link', start: m.index, end: m.index + m[0].length, text: m[1]!, href: m[2]! });
  }
  markers.sort((a, b) => a.start - b.start);

  for (const mk of markers) {
    if (mk.start > lastIdx) {
      out.push(...splitByInlineCode(line.slice(lastIdx, mk.start)));
    }
    if (mk.kind === 'at') {
      out.push({ tag: 'at', user_id: mk.userId });
    } else {
      out.push({ tag: 'a', text: mk.text, href: mk.href });
    }
    lastIdx = mk.end;
  }
  if (lastIdx < line.length) {
    out.push(...splitByInlineCode(line.slice(lastIdx)));
  }

  return out.length ? out : [{ tag: 'text', text: line }];
}

/** 切出行内 code 片段 */
function splitByInlineCode(segment: string): PostBuilderRow {
  if (!segment) return [];
  const parts: PostBuilderRow = [];
  const codeRe = /`([^`]+)`/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = codeRe.exec(segment)) !== null) {
    if (m.index > lastIdx) {
      parts.push(...splitByEmphasis(segment.slice(lastIdx, m.index)));
    }
    // 行内 code 飞书用 md 样式（加反引号标记），避免破坏原意
    parts.push({ tag: 'text', text: `\`${m[1]}\`` });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < segment.length) {
    parts.push(...splitByEmphasis(segment.slice(lastIdx)));
  }
  return parts.length ? parts : [{ tag: 'text', text: segment }];
}

/**
 * 切出加粗 / 斜体
 *
 * 飞书 Post text 元素 style 支持 'bold' / 'italic' / 'underline' / 'lineThrough'。
 * 按从长到短的顺序匹配：**b**、__b__ → bold；*i*、_i_ → italic；~~s~~ → lineThrough。
 * 嵌套（如 ***粗斜***）仅支持一层样式，外层规则优先。
 */
const EMPHASIS_PATTERNS: Array<{
  re: RegExp;
  style: NonNullable<PostBuilderElement['style']>;
}> = [
  { re: /\*\*([^*\n]+)\*\*/g, style: ['bold'] },
  { re: /__([^_\n]+)__/g, style: ['bold'] },
  { re: /~~([^~\n]+)~~/g, style: ['lineThrough'] },
  { re: /(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, style: ['italic'] },
  { re: /(?<![\w_])_([^_\n]+)_(?![\w_])/g, style: ['italic'] },
];

function splitByEmphasis(segment: string): PostBuilderRow {
  if (!segment) return [];

  // 收集所有命中位置
  type Hit = {
    start: number;
    end: number;
    text: string;
    style: NonNullable<PostBuilderElement['style']>;
  };
  const hits: Hit[] = [];
  for (const { re, style } of EMPHASIS_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(segment)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, text: m[1]!, style });
    }
  }
  if (hits.length === 0) return [{ tag: 'text', text: segment }];

  // 按 start 升序；遇到重叠取先到者
  hits.sort((a, b) => a.start - b.start);
  const selected: Hit[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start >= cursor) {
      selected.push(h);
      cursor = h.end;
    }
  }

  const out: PostBuilderRow = [];
  let idx = 0;
  for (const h of selected) {
    if (h.start > idx) {
      out.push({ tag: 'text', text: segment.slice(idx, h.start) });
    }
    out.push({ tag: 'text', text: h.text, style: h.style });
    idx = h.end;
  }
  if (idx < segment.length) {
    out.push({ tag: 'text', text: segment.slice(idx) });
  }
  return out.length ? out : [{ tag: 'text', text: segment }];
}

/** 序列化 PostBuilderPayload 为可直接作为 message.create content 字段的 JSON 字符串 */
export function serializePostContent(payload: PostBuilderPayload): string {
  return JSON.stringify(payload);
}
