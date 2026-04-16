/**
 * Skill 参数替换 — 在 SKILL.md body 中替换参数占位符
 *
 * 参考 Claude Code argumentSubstitution.ts:
 * - $ARGUMENTS — 完整参数字符串
 * - $ARGUMENTS[0], $ARGUMENTS[1] — 按索引访问
 * - $0, $1 — 索引简写
 *
 * EvoClaw G3 扩展：命名参数
 * - ${name} — 命名参数占位符（面向非技术用户）
 * - 支持 kv 风格调用：`args: "month=4 week=1"` → ${month}→"4"
 * - 支持位置映射：`args: "4 1"` + `arguments: [month, week]` → ${month}→"4"
 *
 * 示例:
 *   body: "搜索 $ARGUMENTS 的相关信息"
 *   args: "人工智能"
 *   结果: "搜索 人工智能 的相关信息"
 *
 *   body: "比较 $0 和 $1"
 *   args: "React Vue"
 *   结果: "比较 React 和 Vue"
 *
 *   body: "生成 ${month} 月第 ${week} 周的日报"
 *   args: "month=4 week=1"
 *   结果: "生成 4 月第 1 周的日报"
 *
 *   body: "生成 ${month} 月第 ${week} 周的日报"
 *   args: "4 1"
 *   argumentNames: ["month", "week"]
 *   结果: "生成 4 月第 1 周的日报"
 */

/**
 * 在 SKILL.md body 中替换参数占位符
 *
 * @param body SKILL.md 的 Markdown body
 * @param args 用户传入的参数字符串（空格分隔多个参数，支持 kv 风格）
 * @param argumentNames 可选的命名参数列表（来自 SKILL.md `arguments:` 字段），用于位置→命名映射
 * @returns 替换后的 body
 */
export function substituteArguments(
  body: string,
  args: string,
  argumentNames?: string[],
): string {
  if (!args.trim()) return body;

  const { positional, named } = parseArgs(args, argumentNames);

  let result = body;

  // 1. ${name} — 命名参数（最先替换，避免与其他占位符冲突）
  //    只替换合法标识符字符（字母、数字、下划线），避免误匹配 shell-style ${VAR:-default}
  if (Object.keys(named).length > 0) {
    result = result.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key) => {
      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
    });
  }

  // 2. $ARGUMENTS[N] — 按索引访问（必须在 $ARGUMENTS 之前替换，否则 $ARGUMENTS 会吞掉 [N] 前缀）
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx) => {
    const i = parseInt(idx, 10);
    return i < positional.length ? positional[i] : '';
  });

  // 3. $ARGUMENTS — 完整参数字符串
  result = result.replace(/\$ARGUMENTS/g, args);

  // 4. $N — 索引简写（$0, $1, $2, ...）
  // 注意：只替换 $0-$9，避免误匹配 $100 等
  result = result.replace(/\$(\d)(?!\d)/g, (_, idx) => {
    const i = parseInt(idx, 10);
    return i < positional.length ? positional[i] : '';
  });

  return result;
}

/** 参数解析结果 */
interface ParsedArgs {
  /** 位置参数（按顺序） */
  positional: string[];
  /** 命名参数（kv 或位置→命名映射） */
  named: Record<string, string>;
}

/**
 * 解析参数字符串
 * 支持：
 * - 引号包裹的带空格参数：`hello world "foo bar" baz` → ['hello', 'world', 'foo bar', 'baz']
 * - kv 风格：`month=4 week=1` → named: {month:"4", week:"1"}，同时保留位置形式
 * - 混合：`foo month=4 bar` → positional:["foo", "bar"]，named:{month:"4"}
 *
 * 若提供了 argumentNames 且**没有任何 kv 参数**，则把位置参数按顺序映射到命名参数：
 *   args="4 1", argumentNames=["month","week"] → named:{month:"4", week:"1"}
 */
function parseArgs(args: string, argumentNames?: string[]): ParsedArgs {
  const parts = tokenize(args);
  const positional: string[] = [];
  const named: Record<string, string> = {};

  for (const token of parts) {
    const kvMatch = token.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (kvMatch) {
      named[kvMatch[1]] = kvMatch[2];
    } else {
      positional.push(token);
    }
  }

  // 位置 → 命名映射：仅当声明了 argumentNames 且没有任何 kv 参数时启用
  // 这样可以兼容既有的 $0/$1 用法，同时让 `${name}` 占位符在纯位置调用下也能工作
  if (argumentNames && argumentNames.length > 0 && Object.keys(named).length === 0) {
    for (let i = 0; i < Math.min(positional.length, argumentNames.length); i++) {
      named[argumentNames[i]] = positional[i];
    }
  }

  return { positional, named };
}

/** 词法分解：处理引号包裹的带空格参数 */
function tokenize(args: string): string[] {
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
