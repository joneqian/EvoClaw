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
  tag: 'text' | 'a' | 'code_block' | 'md';
  text?: string;
  href?: string;
  style?: string[];
}

type PostBuilderRow = PostBuilderElement[];

export interface PostBuilderPayload {
  zh_cn: {
    title?: string;
    content: PostBuilderRow[];
  };
}

const CODE_FENCE = /^```([\w+-]*)\s*$/;

/** 判断字符串是否"看起来像 Markdown"，不确定时也当成 Markdown 走富文本 */
const MARKDOWN_HINT_RE = /(\*\*|__|`|~~|^\s*[-*+]\s|^\s*\d+\.\s|^\s*#{1,6}\s|^\s*>|\[[^\]]+\]\()/m;

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
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(line)) !== null) {
    if (match.index > lastIdx) {
      out.push(...splitByInlineCode(line.slice(lastIdx, match.index)));
    }
    out.push({ tag: 'a', text: match[1]!, href: match[2]! });
    lastIdx = match.index + match[0].length;
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
 * 当前实现：保留原始 Markdown 标记（**...** / *...*）直接作为纯文本，
 * 飞书 Post 不原生支持样式交集时降级。避免过度解析导致嵌套错位。
 */
function splitByEmphasis(segment: string): PostBuilderRow {
  if (!segment) return [];
  return [{ tag: 'text', text: segment }];
}

/** 序列化 PostBuilderPayload 为可直接作为 message.create content 字段的 JSON 字符串 */
export function serializePostContent(payload: PostBuilderPayload): string {
  return JSON.stringify(payload);
}
