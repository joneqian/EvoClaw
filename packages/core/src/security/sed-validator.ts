/**
 * Sed 命令专项安全验证
 *
 * sed 是文件编辑工具中最危险的 — 它可以在单条命令中读写任意文件，
 * 且 sed 语法允许嵌入 shell 命令执行（通过 e 标志和 w 命令）。
 *
 * 两种安全模式:
 * 1. 行打印 (sed -n): 只允许 p 命令
 * 2. 替换 (sed 's/.../.../'): 禁止 e/w 标志
 *
 * 参考 Claude Code src/tools/BashTool/sedValidation.ts
 */

import type { SimpleCommand } from './bash-parser/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SedValidationResult {
  /** 是否安全 */
  safe: boolean;
  /** 不安全原因 */
  reason?: string;
  /** sed 模式: print / substitute / unknown */
  mode?: 'print' | 'substitute' | 'unknown';
  /** 是否包含 -i (就地编辑) */
  inPlace: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 安全的 sed 标志白名单 */
const SAFE_FLAGS = new Set([
  '-n', '-E', '-r', '-e', '-z',
  '--quiet', '--silent', '--regexp-extended', '--null-data',
]);

/** 安全的替换修饰符 */
const SAFE_SUBSTITUTION_FLAGS = new Set([
  'g', 'p', 'i', 'I', 'm', 'M',
  '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

/** 危险的 sed 命令/标志 */
const DANGEROUS_SED_PATTERNS = [
  /\/e\b/,       // e 标志: 执行替换结果为 shell 命令
  /\/w\s/,       // w 命令: 写入到文件
  /\/w$/,        // w 命令 (行末)
];

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 验证 sed 命令的安全性
 *
 * @param cmd 已解析的 SimpleCommand (argv[0] === 'sed')
 * @param allowFileWrites 是否允许文件写入 (影响 -i 标志)
 */
export function validateSedCommand(
  cmd: SimpleCommand,
  allowFileWrites: boolean = false,
): SedValidationResult {
  const args = cmd.argv.slice(1); // 去掉 'sed'
  if (args.length === 0) {
    return { safe: true, inPlace: false };
  }

  // 解析 flags 和 expressions
  const parsed = parseSedArgs(args);

  // 检查 -i (就地编辑)
  if (parsed.inPlace && !allowFileWrites) {
    return {
      safe: false,
      reason: 'sed -i (就地编辑) 需要文件写入权限',
      mode: parsed.mode,
      inPlace: true,
    };
  }

  // 验证标志安全性
  const flagResult = validateFlags(parsed.flags);
  if (!flagResult.safe) {
    return { ...flagResult, mode: parsed.mode, inPlace: parsed.inPlace };
  }

  // 验证 expression 安全性
  for (const expr of parsed.expressions) {
    const exprResult = validateExpression(expr, parsed.hasN);
    if (!exprResult.safe) {
      return { ...exprResult, mode: parsed.mode, inPlace: parsed.inPlace };
    }
  }

  // 检查危险模式
  const rawExpr = parsed.expressions.join(' ');
  for (const pattern of DANGEROUS_SED_PATTERNS) {
    if (pattern.test(rawExpr)) {
      return {
        safe: false,
        reason: `sed 表达式包含危险模式: ${rawExpr.slice(0, 50)}`,
        mode: parsed.mode,
        inPlace: parsed.inPlace,
      };
    }
  }

  return { safe: true, mode: parsed.mode, inPlace: parsed.inPlace };
}

// ═══════════════════════════════════════════════════════════════════════════
// Arg Parsing
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedSedArgs {
  flags: string[];
  expressions: string[];
  hasN: boolean;
  inPlace: boolean;
  mode: 'print' | 'substitute' | 'unknown';
}

function parseSedArgs(args: string[]): ParsedSedArgs {
  const flags: string[] = [];
  const expressions: string[] = [];
  let hasN = false;
  let inPlace = false;
  let expectExpr = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (expectExpr) {
      expressions.push(arg);
      expectExpr = false;
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      // 组合标志: -nEi → 逐字符
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (flag === 'n') hasN = true;
        if (flag === 'i') inPlace = true;
        if (flag === 'e') {
          expectExpr = true; // 下一个参数是 expression
        }
        flags.push(`-${flag}`);
      }
      continue;
    }

    if (arg === '--in-place') {
      inPlace = true;
      flags.push(arg);
      continue;
    }

    if (arg.startsWith('--')) {
      flags.push(arg);
      continue;
    }

    // 非标志参数 → expression 或 file
    if (expressions.length === 0) {
      expressions.push(arg);
    }
    // 后续参数是文件名，忽略
  }

  // 判断模式
  let mode: 'print' | 'substitute' | 'unknown' = 'unknown';
  if (expressions.length > 0) {
    const expr = expressions[0];
    if (isPrintExpression(expr)) mode = 'print';
    else if (isSubstituteExpression(expr)) mode = 'substitute';
  }

  return { flags, expressions, hasN, inPlace, mode };
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation Functions
// ═══════════════════════════════════════════════════════════════════════════

function validateFlags(flags: string[]): SedValidationResult {
  for (const flag of flags) {
    // 组合标志已拆分为单字符
    if (flag === '-i') continue; // -i 已在上层处理
    if (!SAFE_FLAGS.has(flag)) {
      return { safe: false, reason: `不安全的 sed 标志: ${flag}`, inPlace: false };
    }
  }
  return { safe: true, inPlace: false };
}

function validateExpression(expr: string, hasN: boolean): SedValidationResult {
  // 行打印模式: sed -n '5p' / '1,10p'
  if (hasN && isPrintExpression(expr)) {
    return { safe: true, inPlace: false };
  }

  // 替换模式: sed 's/old/new/flags'
  if (isSubstituteExpression(expr)) {
    return validateSubstitution(expr);
  }

  // 删除命令: sed '5d' / '1,10d' — 安全（只影响输出）
  if (/^\d+(,\d+)?d$/.test(expr)) {
    return { safe: true, inPlace: false };
  }

  // 未知表达式 → 不安全
  return { safe: false, reason: `无法验证的 sed 表达式: ${expr.slice(0, 50)}`, inPlace: false };
}

function validateSubstitution(expr: string): SedValidationResult {
  // 只允许 / 作为定界符
  const match = expr.match(/^(?:\d+(?:,\d+)?)?s(.)(.*)$/);
  if (!match) {
    return { safe: false, reason: '无法解析 sed 替换表达式', inPlace: false };
  }

  const delimiter = match[1];
  if (delimiter !== '/') {
    // 非标准定界符 — 不一定危险，但增加误解风险
    // 仍允许但标记
  }

  const rest = match[2];
  // 找到最后的定界符后的 flags
  const parts = splitSedExpression(rest, delimiter);
  if (parts === null) {
    return { safe: false, reason: '无法解析 sed 替换表达式定界符', inPlace: false };
  }

  const flags = parts.flags;
  for (const f of flags) {
    if (f === 'e') {
      return { safe: false, reason: 'sed e 标志（执行替换结果为 shell 命令）被禁止', inPlace: false };
    }
    if (f === 'w') {
      return { safe: false, reason: 'sed w 命令（写入到文件）被禁止', inPlace: false };
    }
    if (!SAFE_SUBSTITUTION_FLAGS.has(f)) {
      return { safe: false, reason: `不安全的 sed 替换标志: ${f}`, inPlace: false };
    }
  }

  return { safe: true, inPlace: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Expression Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isPrintExpression(expr: string): boolean {
  // Np 或 N,Mp 格式
  return /^\d+(,\d+)?p(;\d+(,\d+)?p)*$/.test(expr);
}

function isSubstituteExpression(expr: string): boolean {
  return /^(?:\d+(?:,\d+)?)?s./.test(expr);
}

/** 拆分 sed 替换表达式 pattern/replacement/flags */
function splitSedExpression(rest: string, delimiter: string): { pattern: string; replacement: string; flags: string[] } | null {
  let i = 0;
  let escaped = false;

  // 跳过 pattern
  while (i < rest.length) {
    if (escaped) { escaped = false; i++; continue; }
    if (rest[i] === '\\') { escaped = true; i++; continue; }
    if (rest[i] === delimiter) break;
    i++;
  }
  const pattern = rest.slice(0, i);
  i++; // skip delimiter

  // 跳过 replacement
  const repStart = i;
  escaped = false;
  while (i < rest.length) {
    if (escaped) { escaped = false; i++; continue; }
    if (rest[i] === '\\') { escaped = true; i++; continue; }
    if (rest[i] === delimiter) break;
    i++;
  }
  const replacement = rest.slice(repStart, i);
  i++; // skip delimiter

  // flags
  const flagStr = rest.slice(i);
  const flags = flagStr.split('').filter(f => f.trim());

  return { pattern, replacement, flags };
}
