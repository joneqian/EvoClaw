/**
 * Bash 词法分析器 (Tokenizer)
 *
 * 纯 TypeScript 实现，将 bash 命令字符串拆分为 Token 序列。
 * 不追求 100% bash 兼容 — 覆盖 LLM 常生成的命令模式，
 * 罕见语法返回 null 由上层走 too-complex 路径。
 *
 * 参考 Claude Code src/utils/bash/bashParser.ts Token 类型
 */

import type { Token, TokenType, ParseBudget } from './types.js';
import { DEFAULT_BUDGET } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Character Classification
// ═══════════════════════════════════════════════════════════════════════════

const WHITESPACE = new Set([' ', '\t']);
const OPERATORS = new Set(['&', '|', ';', '(', ')', '<', '>', '{', '}', '!']);
const WORD_BREAK = new Set([' ', '\t', '\n', '&', '|', ';', '(', ')', '<', '>', '#', '"', "'", '`', '$', '\0', '{', '}', '!']);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

// ═══════════════════════════════════════════════════════════════════════════
// Tokenizer State
// ═══════════════════════════════════════════════════════════════════════════

interface TokenizerState {
  source: string;
  pos: number;
  tokens: Token[];
  budget: ParseBudget;
  deadline: number;
  tokenCount: number;
  aborted: boolean;
}

function checkBudget(state: TokenizerState): void {
  state.tokenCount++;
  if (state.tokenCount > state.budget.maxNodes) {
    state.aborted = true;
    throw new Error('budget');
  }
  // 每 64 个 token 检查一次时间
  if ((state.tokenCount & 0x3f) === 0 && performance.now() > state.deadline) {
    state.aborted = true;
    throw new Error('timeout');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 将 bash 命令字符串拆分为 Token 序列
 * @returns Token 数组，或 null (超时/预算耗尽)
 */
export function tokenize(source: string, budget: ParseBudget = DEFAULT_BUDGET): Token[] | null {
  const state: TokenizerState = {
    source,
    pos: 0,
    tokens: [],
    budget,
    deadline: performance.now() + budget.timeoutMs,
    tokenCount: 0,
    aborted: false,
  };

  try {
    while (state.pos < source.length) {
      skipWhitespace(state);
      if (state.pos >= source.length) break;

      const ch = source[state.pos];

      // 换行
      if (ch === '\n') {
        pushToken(state, 'NEWLINE', '\n', state.pos, state.pos + 1);
        state.pos++;
        continue;
      }

      // 注释
      if (ch === '#') {
        scanComment(state);
        continue;
      }

      // 单引号
      if (ch === "'") {
        scanSingleQuote(state);
        continue;
      }

      // 双引号
      if (ch === '"') {
        scanDoubleQuote(state);
        continue;
      }

      // $ 前缀（变量、命令替换、算术、ANSI-C）
      if (ch === '$') {
        scanDollar(state);
        continue;
      }

      // 反引号
      if (ch === '`') {
        scanBacktick(state);
        continue;
      }

      // 操作符
      if (OPERATORS.has(ch)) {
        scanOperator(state);
        continue;
      }

      // 普通 WORD
      scanWord(state);
    }

    // EOF
    pushToken(state, 'EOF', '', source.length, source.length);
    return state.tokens;
  } catch {
    if (state.aborted) return null;
    throw new Error('tokenizer_error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Scan Functions
// ═══════════════════════════════════════════════════════════════════════════

function skipWhitespace(state: TokenizerState): void {
  while (state.pos < state.source.length && WHITESPACE.has(state.source[state.pos])) {
    state.pos++;
  }
}

function scanComment(state: TokenizerState): void {
  const start = state.pos;
  state.pos++; // skip #
  while (state.pos < state.source.length && state.source[state.pos] !== '\n') {
    state.pos++;
  }
  pushToken(state, 'COMMENT', state.source.slice(start, state.pos), start, state.pos);
}

function scanSingleQuote(state: TokenizerState): void {
  const start = state.pos;
  state.pos++; // skip opening '
  while (state.pos < state.source.length && state.source[state.pos] !== "'") {
    state.pos++;
  }
  if (state.pos < state.source.length) state.pos++; // skip closing '
  pushToken(state, 'SQUOTE', state.source.slice(start, state.pos), start, state.pos);
}

function scanDoubleQuote(state: TokenizerState): void {
  const start = state.pos;
  state.pos++; // skip opening "
  while (state.pos < state.source.length && state.source[state.pos] !== '"') {
    if (state.source[state.pos] === '\\') {
      state.pos++; // skip escaped char
    }
    state.pos++;
  }
  if (state.pos < state.source.length) state.pos++; // skip closing "
  pushToken(state, 'DQUOTE', state.source.slice(start, state.pos), start, state.pos);
}

function scanDollar(state: TokenizerState): void {
  const start = state.pos;
  state.pos++; // skip $

  if (state.pos >= state.source.length) {
    pushToken(state, 'DOLLAR', '$', start, state.pos);
    return;
  }

  const next = state.source[state.pos];

  // $'...' ANSI-C 引用
  if (next === "'") {
    state.pos++; // skip '
    while (state.pos < state.source.length && state.source[state.pos] !== "'") {
      if (state.source[state.pos] === '\\') state.pos++;
      state.pos++;
    }
    if (state.pos < state.source.length) state.pos++; // skip closing '
    pushToken(state, 'ANSI_C', state.source.slice(start, state.pos), start, state.pos);
    return;
  }

  // $(( — 算术展开
  if (next === '(' && state.pos + 1 < state.source.length && state.source[state.pos + 1] === '(') {
    state.pos += 2; // skip ((
    let depth = 1;
    while (state.pos < state.source.length && depth > 0) {
      if (state.source[state.pos] === '(' && state.source[state.pos - 1] === '$') depth++;
      else if (state.source[state.pos] === ')' && state.pos + 1 < state.source.length && state.source[state.pos + 1] === ')') {
        depth--;
        if (depth === 0) { state.pos += 2; break; }
      }
      state.pos++;
    }
    pushToken(state, 'DOLLAR_DPAREN', state.source.slice(start, state.pos), start, state.pos);
    return;
  }

  // $( — 命令替换
  if (next === '(') {
    state.pos++; // skip (
    let depth = 1;
    while (state.pos < state.source.length && depth > 0) {
      const c = state.source[state.pos];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (c === '\\') state.pos++; // skip escaped
      state.pos++;
    }
    pushToken(state, 'DOLLAR_PAREN', state.source.slice(start, state.pos), start, state.pos);
    return;
  }

  // ${ — 参数展开
  if (next === '{') {
    state.pos++; // skip {
    let depth = 1;
    while (state.pos < state.source.length && depth > 0) {
      if (state.source[state.pos] === '{') depth++;
      else if (state.source[state.pos] === '}') depth--;
      if (state.source[state.pos] === '\\') state.pos++;
      state.pos++;
    }
    pushToken(state, 'DOLLAR_BRACE', state.source.slice(start, state.pos), start, state.pos);
    return;
  }

  // $VAR — 简单变量
  if (next === '_' || (next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z')) {
    while (state.pos < state.source.length) {
      const c = state.source[state.pos];
      if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || isDigit(c)) {
        state.pos++;
      } else {
        break;
      }
    }
    pushToken(state, 'DOLLAR', state.source.slice(start, state.pos), start, state.pos);
    return;
  }

  // $? $$ $! $# $0-$9 等特殊变量
  if ('?$!#@*-0123456789'.includes(next)) {
    state.pos++;
    pushToken(state, 'DOLLAR', state.source.slice(start, state.pos), start, state.pos);
    return;
  }

  pushToken(state, 'DOLLAR', '$', start, start + 1);
}

function scanBacktick(state: TokenizerState): void {
  const start = state.pos;
  state.pos++; // skip opening `
  while (state.pos < state.source.length && state.source[state.pos] !== '`') {
    if (state.source[state.pos] === '\\') state.pos++;
    state.pos++;
  }
  if (state.pos < state.source.length) state.pos++; // skip closing `
  pushToken(state, 'BACKTICK', state.source.slice(start, state.pos), start, state.pos);
}

function scanOperator(state: TokenizerState): void {
  const start = state.pos;
  const ch = state.source[state.pos];
  const next = state.pos + 1 < state.source.length ? state.source[state.pos + 1] : '';

  // 二字符操作符
  if (ch === '&' && next === '&') { state.pos += 2; pushToken(state, 'OP', '&&', start, state.pos); return; }
  if (ch === '|' && next === '|') { state.pos += 2; pushToken(state, 'OP', '||', start, state.pos); return; }
  if (ch === '|' && next === '&') { state.pos += 2; pushToken(state, 'OP', '|&', start, state.pos); return; }
  if (ch === '>' && next === '>') { state.pos += 2; pushToken(state, 'OP', '>>', start, state.pos); return; }
  if (ch === '>' && next === '&') { state.pos += 2; pushToken(state, 'OP', '>&', start, state.pos); return; }
  if (ch === '<' && next === '&') { state.pos += 2; pushToken(state, 'OP', '<&', start, state.pos); return; }
  if (ch === '&' && next === '>') {
    const third = state.pos + 2 < state.source.length ? state.source[state.pos + 2] : '';
    if (third === '>') { state.pos += 3; pushToken(state, 'OP', '&>>', start, state.pos); return; }
    state.pos += 2;
    pushToken(state, 'OP', '&>', start, state.pos);
    return;
  }

  // Heredoc: <<- / <<
  if (ch === '<' && next === '<') {
    const third = state.pos + 2 < state.source.length ? state.source[state.pos + 2] : '';
    if (third === '-') { state.pos += 3; pushToken(state, 'HEREDOC_OP', '<<-', start, state.pos); return; }
    if (third === '<') { state.pos += 3; pushToken(state, 'OP', '<<<', start, state.pos); return; } // here-string
    state.pos += 2;
    pushToken(state, 'HEREDOC_OP', '<<', start, state.pos);
    return;
  }

  // 进程替换: <( >(
  if (ch === '<' && next === '(') { state.pos += 2; pushToken(state, 'LT_PAREN', '<(', start, state.pos); return; }
  if (ch === '>' && next === '(') { state.pos += 2; pushToken(state, 'GT_PAREN', '>(', start, state.pos); return; }

  // 单字符操作符
  state.pos++;
  pushToken(state, 'OP', ch, start, state.pos);
}

function scanWord(state: TokenizerState): void {
  const start = state.pos;
  while (state.pos < state.source.length) {
    const ch = state.source[state.pos];

    // 反斜杠转义
    if (ch === '\\' && state.pos + 1 < state.source.length) {
      state.pos += 2;
      continue;
    }

    // 遇到 word 分隔符停止
    if (WORD_BREAK.has(ch) || WHITESPACE.has(ch)) break;

    state.pos++;
  }

  const value = state.source.slice(start, state.pos);
  // 区分纯数字和普通 WORD
  const type: TokenType = /^-?\d+$/.test(value) ? 'NUMBER' : 'WORD';
  pushToken(state, type, value, start, state.pos);
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function pushToken(state: TokenizerState, type: TokenType, value: string, start: number, end: number): void {
  checkBudget(state);
  state.tokens.push({ type, value, start, end });
}
