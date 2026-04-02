/**
 * Skill 参数替换 — 在 SKILL.md body 中替换 $ARGUMENTS 占位符
 *
 * 参考 Claude Code argumentSubstitution.ts:
 * - $ARGUMENTS — 完整参数字符串
 * - $ARGUMENTS[0], $ARGUMENTS[1] — 按索引访问
 * - $0, $1 — 索引简写
 *
 * 示例:
 *   body: "搜索 $ARGUMENTS 的相关信息"
 *   args: "人工智能"
 *   结果: "搜索 人工智能 的相关信息"
 *
 *   body: "比较 $0 和 $1"
 *   args: "React Vue"
 *   结果: "比较 React 和 Vue"
 */

/**
 * 在 SKILL.md body 中替换参数占位符
 *
 * @param body SKILL.md 的 Markdown body
 * @param args 用户传入的参数字符串（空格分隔多个参数）
 * @returns 替换后的 body
 */
export function substituteArguments(body: string, args: string): string {
  if (!args.trim()) return body;

  const argParts = parseArgs(args);

  let result = body;

  // 1. $ARGUMENTS[N] — 按索引访问（必须在 $ARGUMENTS 之前替换，否则 $ARGUMENTS 会吞掉 [N] 前缀）
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx) => {
    const i = parseInt(idx, 10);
    return i < argParts.length ? argParts[i] : '';
  });

  // 2. $ARGUMENTS — 完整参数字符串
  result = result.replace(/\$ARGUMENTS/g, args);

  // 3. $N — 索引简写（$0, $1, $2, ...）
  // 注意：只替换 $0-$9，避免误匹配 $100 等
  result = result.replace(/\$(\d)(?!\d)/g, (_, idx) => {
    const i = parseInt(idx, 10);
    return i < argParts.length ? argParts[i] : '';
  });

  return result;
}

/**
 * 解析参数字符串为数组
 * 支持引号包裹的带空格参数：
 *   'hello world "foo bar" baz' → ['hello', 'world', 'foo bar', 'baz']
 */
function parseArgs(args: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of args) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  return parts;
}
