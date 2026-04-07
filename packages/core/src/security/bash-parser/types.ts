/**
 * Bash 解析器共享类型
 *
 * AST 节点结构兼容 tree-sitter-bash 风格，便于日后对齐。
 * 参考 Claude Code src/utils/bash/bashParser.ts
 */

// ═══════════════════════════════════════════════════════════════════════════
// Token Types
// ═══════════════════════════════════════════════════════════════════════════

export type TokenType =
  | 'WORD'           // 普通单词: ls, foo.txt, -la
  | 'NUMBER'         // 数字: 42, -1
  | 'OP'             // 操作符: &&, ||, |, ;, &, >, >>, <<, <, |&
  | 'NEWLINE'        // 换行符
  | 'COMMENT'        // 注释: # ...
  | 'DQUOTE'         // 双引号: "
  | 'SQUOTE'         // 单引号字符串: '...'
  | 'ANSI_C'         // ANSI-C 字符串: $'\n'
  | 'DOLLAR'         // $
  | 'DOLLAR_PAREN'   // $( — 命令替换开始
  | 'DOLLAR_BRACE'   // ${ — 参数展开开始
  | 'DOLLAR_DPAREN'  // $(( — 算术展开开始
  | 'BACKTICK'       // ` — 反引号
  | 'LT_PAREN'       // <( — 进程替换
  | 'GT_PAREN'       // >( — 进程替换
  | 'HEREDOC_OP'     // << / <<- — heredoc 操作符
  | 'EOF';           // 输入结束

export interface Token {
  type: TokenType;
  value: string;
  /** UTF-8 字节起始偏移 */
  start: number;
  /** UTF-8 字节结束偏移 */
  end: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// AST Node Types
// ═══════════════════════════════════════════════════════════════════════════

/** AST 节点 (兼容 tree-sitter-bash TsNode 风格) */
export interface TsNode {
  /** 节点类型 */
  readonly type: string;
  /** 原始源码文本 */
  readonly text: string;
  /** UTF-8 字节起始偏移 */
  readonly startIndex: number;
  /** UTF-8 字节结束偏移 */
  readonly endIndex: number;
  /** 子节点列表 */
  readonly children: readonly TsNode[];
}

/** AST 节点类型常量 */
export const NodeType = {
  PROGRAM: 'program',
  LIST: 'list',                       // a && b || c
  PIPELINE: 'pipeline',               // a | b
  COMMAND: 'command',                  // 简单命令
  SIMPLE_COMMAND: 'simple_command',
  WORD: 'word',
  RAW_STRING: 'raw_string',           // 单引号
  STRING: 'string',                   // 双引号
  STRING_CONTENT: 'string_content',
  VARIABLE_NAME: 'variable_name',
  SIMPLE_EXPANSION: 'simple_expansion', // $VAR
  EXPANSION: 'expansion',             // ${VAR}
  COMMAND_SUBSTITUTION: 'command_substitution', // $(...)
  SUBSHELL: 'subshell',               // (...)
  COMPOUND_STATEMENT: 'compound_statement', // { ...; }
  IF_STATEMENT: 'if_statement',
  FOR_STATEMENT: 'for_statement',
  WHILE_STATEMENT: 'while_statement',
  CASE_STATEMENT: 'case_statement',
  FUNCTION_DEFINITION: 'function_definition',
  REDIRECTED_STATEMENT: 'redirected_statement',
  FILE_REDIRECT: 'file_redirect',
  HEREDOC_REDIRECT: 'heredoc_redirect',
  HEREDOC_BODY: 'heredoc_body',
  VARIABLE_ASSIGNMENT: 'variable_assignment',
  COMMENT: 'comment',
  PROCESS_SUBSTITUTION: 'process_substitution', // <() >()
  ARITHMETIC_EXPANSION: 'arithmetic_expansion', // $((...))
  TEST_COMMAND: 'test_command',        // [[ ]]
  NEGATED_COMMAND: 'negated_command',  // ! cmd
  CONCATENATION: 'concatenation',      // word"mixed"'parts'
} as const;

/** 操作符节点类型 (命令间分隔符) */
export const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n']);

// ═══════════════════════════════════════════════════════════════════════════
// Security Analysis Types
// ═══════════════════════════════════════════════════════════════════════════

/** 重定向信息 */
export interface Redirect {
  /** 重定向操作符: >, >>, <, <<, 2>, 2>>, &>, etc. */
  operator: string;
  /** 目标文件/描述符 */
  target: string;
  /** 文件描述符 (0=stdin, 1=stdout, 2=stderr) */
  fd?: number;
}

/** 标准化后的简单命令 */
export interface SimpleCommand {
  /** argv[0] 是命令名 */
  argv: string[];
  /** 前导 VAR=val 赋值 */
  envVars: ReadonlyArray<{ name: string; value: string }>;
  /** 重定向 */
  redirects: readonly Redirect[];
  /** 原始源码段 */
  text: string;
  /** 命令间连接符 (从上一命令到此命令) */
  separator?: '&&' | '||' | '|' | ';' | '&' | '|&';
}

/** 安全分析结果 */
export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string }
  | { kind: 'parse-unavailable' };

// ═══════════════════════════════════════════════════════════════════════════
// Parser Configuration
// ═══════════════════════════════════════════════════════════════════════════

/** 解析器资源保护配置 */
export interface ParseBudget {
  /** 墙钟超时 (ms)，默认 50 */
  timeoutMs: number;
  /** 节点数预算上限，默认 50,000 */
  maxNodes: number;
}

/** 默认解析器预算 */
export const DEFAULT_BUDGET: Readonly<ParseBudget> = {
  timeoutMs: 50,
  maxNodes: 50_000,
};

/** 解析结果 */
export type ParseResult =
  | { ok: true; root: TsNode }
  | { ok: false; reason: 'timeout' | 'budget' | 'syntax_error'; message: string };
