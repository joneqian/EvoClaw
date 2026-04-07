/**
 * Bash 递归下降解析器
 *
 * 将 Token 序列解析为 AST (TsNode 树)。
 *
 * 语法层次:
 *   parseProgram()
 *     └─ parseStatements() — ; & \n 分隔
 *          └─ parseAndOr() — && || 链
 *               └─ parsePipeline() — | |& 管道
 *                    └─ parseCommand()
 *                         ├─ parseSimpleCommand() — cmd args...
 *                         ├─ parseSubshell() — (...)
 *                         ├─ parseGroupCommand() — { ...; }
 *                         └─ parseCompoundCommand() — if/for/while/case
 *
 * FAIL-CLOSED: 不识别的语法 → too-complex → 用户确认
 * 参考 Claude Code src/utils/bash/bashParser.ts
 */

import type { Token, TsNode, ParseBudget, ParseResult } from './types.js';
import { NodeType, DEFAULT_BUDGET } from './types.js';
import { tokenize } from './tokenizer.js';

// ═══════════════════════════════════════════════════════════════════════════
// Parser State
// ═══════════════════════════════════════════════════════════════════════════

interface ParserState {
  tokens: readonly Token[];
  pos: number;
  source: string;
  budget: ParseBudget;
  deadline: number;
  nodeCount: number;
}

function checkBudget(state: ParserState): void {
  state.nodeCount++;
  if (state.nodeCount > state.budget.maxNodes) {
    throw new Error('budget');
  }
  if ((state.nodeCount & 0x7f) === 0 && performance.now() > state.deadline) {
    throw new Error('timeout');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Token Helpers
// ═══════════════════════════════════════════════════════════════════════════

function peek(state: ParserState): Token {
  return state.tokens[state.pos] ?? { type: 'EOF', value: '', start: state.source.length, end: state.source.length };
}

function advance(state: ParserState): Token {
  const tok = peek(state);
  if (tok.type !== 'EOF') state.pos++;
  return tok;
}

function match(state: ParserState, type: string, value?: string): boolean {
  const tok = peek(state);
  if (tok.type !== type) return false;
  if (value !== undefined && tok.value !== value) return false;
  return true;
}

function expect(state: ParserState, type: string, value?: string): Token {
  const tok = advance(state);
  if (tok.type !== type || (value !== undefined && tok.value !== value)) {
    throw new Error(`syntax_error: expected ${type}${value ? `(${value})` : ''}, got ${tok.type}(${tok.value})`);
  }
  return tok;
}

function matchOp(state: ParserState, value: string): boolean {
  return match(state, 'OP', value);
}

/** 跳过换行和注释 */
function skipNewlines(state: ParserState): void {
  while (peek(state).type === 'NEWLINE' || peek(state).type === 'COMMENT') {
    advance(state);
  }
}

/** 复合命令的"结束"关键字 — 不能作为新命令开始 */
const CLOSING_KEYWORDS = new Set(['then', 'do', 'done', 'fi', 'elif', 'else', 'esac', 'in', '}']);

/** 是否是命令起始 token */
function isCommandStart(tok: Token): boolean {
  if (tok.type === 'EOF') return false;
  if (tok.type === 'WORD') {
    // 排除复合命令结束关键字
    return !CLOSING_KEYWORDS.has(tok.value);
  }
  if (tok.type === 'NUMBER') return true;
  if (tok.type === 'SQUOTE' || tok.type === 'DQUOTE' || tok.type === 'DOLLAR' ||
      tok.type === 'DOLLAR_PAREN' || tok.type === 'DOLLAR_BRACE' ||
      tok.type === 'DOLLAR_DPAREN' || tok.type === 'BACKTICK' ||
      tok.type === 'ANSI_C') return true;
  if (tok.type === 'OP' && (tok.value === '(' || tok.value === '{' || tok.value === '!')) return true;
  return false;
}

/** 是否是可作为 word 一部分的 token */
function isWordToken(tok: Token): boolean {
  return tok.type === 'WORD' || tok.type === 'NUMBER' ||
    tok.type === 'SQUOTE' || tok.type === 'DQUOTE' ||
    tok.type === 'DOLLAR' || tok.type === 'DOLLAR_PAREN' ||
    tok.type === 'DOLLAR_BRACE' || tok.type === 'DOLLAR_DPAREN' ||
    tok.type === 'BACKTICK' || tok.type === 'ANSI_C';
}

/** shell 关键字 (供 isCommandStart 等函数使用) */
const _KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi',
  'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'in',
  'function',
  '{', '}',
]);
// 导出供未来 Sprint 3 语义分析使用
export { _KEYWORDS as KEYWORDS };

/** 是否是变量赋值: NAME=... */
function isAssignment(tok: Token): boolean {
  if (tok.type !== 'WORD') return false;
  const eqIdx = tok.value.indexOf('=');
  if (eqIdx <= 0) return false;
  const name = tok.value.slice(0, eqIdx);
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

// ═══════════════════════════════════════════════════════════════════════════
// Node Builder
// ═══════════════════════════════════════════════════════════════════════════

function makeNode(state: ParserState, type: string, startIdx: number, endIdx: number, children: TsNode[] = []): TsNode {
  checkBudget(state);
  return {
    type,
    text: state.source.slice(startIdx, endIdx),
    startIndex: startIdx,
    endIndex: endIdx,
    children,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 解析 bash 命令字符串为 AST
 */
export function parse(source: string, budget: ParseBudget = DEFAULT_BUDGET): ParseResult {
  const tokens = tokenize(source, budget);
  if (tokens === null) {
    return { ok: false, reason: 'timeout', message: 'tokenizer timeout or budget exceeded' };
  }

  const state: ParserState = {
    tokens,
    pos: 0,
    source,
    budget,
    deadline: performance.now() + budget.timeoutMs,
    nodeCount: 0,
  };

  try {
    const root = parseProgram(state);
    return { ok: true, root };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'timeout') return { ok: false, reason: 'timeout', message: 'parser timeout' };
    if (msg === 'budget') return { ok: false, reason: 'budget', message: 'node budget exceeded' };
    return { ok: false, reason: 'syntax_error', message: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Grammar Rules
// ═══════════════════════════════════════════════════════════════════════════

/**
 * program := statements EOF
 */
function parseProgram(state: ParserState): TsNode {
  skipNewlines(state);
  const children = parseStatements(state);
  return makeNode(state, NodeType.PROGRAM, 0, state.source.length, children);
}

/**
 * statements := andOr ( (';' | '&' | '\n') andOr )*
 */
function parseStatements(state: ParserState): TsNode[] {
  const children: TsNode[] = [];
  skipNewlines(state);

  if (!isCommandStart(peek(state))) return children;

  children.push(parseAndOr(state));

  while (true) {
    const tok = peek(state);
    // 语句分隔符
    if (tok.type === 'OP' && (tok.value === ';' || tok.value === '&')) {
      const sep = advance(state);
      children.push(makeNode(state, sep.value, sep.start, sep.end));
      skipNewlines(state);
      if (!isCommandStart(peek(state))) break;
      children.push(parseAndOr(state));
    } else if (tok.type === 'NEWLINE') {
      children.push(makeNode(state, '\n', tok.start, tok.end));
      advance(state);
      skipNewlines(state);
      if (!isCommandStart(peek(state))) break;
      children.push(parseAndOr(state));
    } else {
      break;
    }
  }

  // 如果只有一个子节点，直接返回 (不需要 list 包装)
  return children;
}

/**
 * andOr := pipeline ( ('&&' | '||') pipeline )*
 */
function parseAndOr(state: ParserState): TsNode {
  let left = parsePipeline(state);

  while (matchOp(state, '&&') || matchOp(state, '||')) {
    const opTok = advance(state);
    const opNode = makeNode(state, opTok.value, opTok.start, opTok.end);
    skipNewlines(state);
    const right = parsePipeline(state);
    left = makeNode(state, NodeType.LIST, left.startIndex, right.endIndex, [left, opNode, right]);
  }

  return left;
}

/**
 * pipeline := ['!'] command ( ('|' | '|&') command )*
 */
function parsePipeline(state: ParserState): TsNode {
  // 否定
  let negated = false;
  let negStart = peek(state).start;
  if (matchOp(state, '!')) {
    negated = true;
    advance(state);
  }

  let left = parseCommand(state);

  while (matchOp(state, '|') || matchOp(state, '|&')) {
    const opTok = advance(state);
    const opNode = makeNode(state, opTok.value, opTok.start, opTok.end);
    skipNewlines(state);
    const right = parseCommand(state);
    left = makeNode(state, NodeType.PIPELINE, left.startIndex, right.endIndex, [left, opNode, right]);
  }

  if (negated) {
    left = makeNode(state, NodeType.NEGATED_COMMAND, negStart, left.endIndex, [left]);
  }

  return left;
}

/**
 * command := subshell | groupCommand | compoundCommand | simpleCommand
 */
function parseCommand(state: ParserState): TsNode {
  const tok = peek(state);

  // 子shell: (...)
  if (tok.type === 'OP' && tok.value === '(') {
    return parseSubshell(state);
  }

  // 命令组: { ...; }
  if (tok.type === 'OP' && tok.value === '{') {
    return parseGroupCommand(state);
  }

  // 复合命令
  if (tok.type === 'WORD') {
    if (tok.value === 'if') return parseIfStatement(state);
    if (tok.value === 'for') return parseForStatement(state);
    if (tok.value === 'while' || tok.value === 'until') return parseWhileStatement(state);
    if (tok.value === 'case') return parseCaseStatement(state);
    if (tok.value === 'function') return parseFunctionDef(state);
  }

  // 简单命令 (含重定向)
  return parseSimpleCommand(state);
}

/**
 * simpleCommand := (assignment | word | redirect)+
 */
function parseSimpleCommand(state: ParserState): TsNode {
  const children: TsNode[] = [];
  const startIdx = peek(state).start;
  let endIdx = startIdx;

  while (true) {
    const tok = peek(state);

    // 重定向: > >> < &> etc.
    if (isRedirectOp(tok)) {
      children.push(parseRedirect(state));
      endIdx = children[children.length - 1].endIndex;
      continue;
    }

    // 数字+重定向: 2> 2>> etc.
    if (tok.type === 'NUMBER' && state.pos + 1 < state.tokens.length) {
      const nextTok = state.tokens[state.pos + 1];
      if (isRedirectOp(nextTok)) {
        children.push(parseRedirect(state));
        endIdx = children[children.length - 1].endIndex;
        continue;
      }
    }

    // Heredoc
    if (tok.type === 'HEREDOC_OP') {
      children.push(parseHeredocRedirect(state));
      endIdx = children[children.length - 1].endIndex;
      continue;
    }

    // 变量赋值: VAR=value
    if (isAssignment(tok) && children.length === 0) {
      const asgn = advance(state);
      children.push(makeNode(state, NodeType.VARIABLE_ASSIGNMENT, asgn.start, asgn.end));
      endIdx = asgn.end;
      continue;
    }

    // 命令字/参数
    if (isWordToken(tok)) {
      children.push(parseWordNode(state));
      endIdx = children[children.length - 1].endIndex;
      continue;
    }

    break;
  }

  if (children.length === 0) {
    throw new Error('syntax_error: expected command');
  }

  return makeNode(state, NodeType.SIMPLE_COMMAND, startIdx, endIdx, children);
}

/** 解析 word 节点 (可能含内嵌 $VAR, "...", '...' 等) */
function parseWordNode(state: ParserState): TsNode {
  const tok = advance(state);
  const nodeType = wordTokenToNodeType(tok.type);
  return makeNode(state, nodeType, tok.start, tok.end);
}

function wordTokenToNodeType(type: string): string {
  switch (type) {
    case 'SQUOTE': return NodeType.RAW_STRING;
    case 'DQUOTE': return NodeType.STRING;
    case 'DOLLAR': return NodeType.SIMPLE_EXPANSION;
    case 'DOLLAR_PAREN': return NodeType.COMMAND_SUBSTITUTION;
    case 'DOLLAR_BRACE': return NodeType.EXPANSION;
    case 'DOLLAR_DPAREN': return NodeType.ARITHMETIC_EXPANSION;
    case 'BACKTICK': return NodeType.COMMAND_SUBSTITUTION;
    case 'ANSI_C': return NodeType.RAW_STRING;
    default: return NodeType.WORD;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Redirect Parsing
// ═══════════════════════════════════════════════════════════════════════════

function isRedirectOp(tok: Token): boolean {
  if (tok.type !== 'OP') return false;
  return tok.value === '>' || tok.value === '>>' || tok.value === '<' ||
    tok.value === '>&' || tok.value === '<&' || tok.value === '&>' || tok.value === '&>>';
}

function parseRedirect(state: ParserState): TsNode {
  const children: TsNode[] = [];
  const startIdx = peek(state).start;

  // 可选的文件描述符数字
  if (peek(state).type === 'NUMBER') {
    const fd = advance(state);
    children.push(makeNode(state, NodeType.WORD, fd.start, fd.end));
  }

  // 重定向操作符
  const op = advance(state);
  children.push(makeNode(state, op.value, op.start, op.end));

  // 目标
  if (isWordToken(peek(state))) {
    children.push(parseWordNode(state));
  }

  const endIdx = children[children.length - 1]?.endIndex ?? op.end;
  return makeNode(state, NodeType.FILE_REDIRECT, startIdx, endIdx, children);
}

function parseHeredocRedirect(state: ParserState): TsNode {
  const startIdx = peek(state).start;
  const op = advance(state); // << or <<-

  // 分隔符 word
  let delimiter = '';
  if (isWordToken(peek(state))) {
    const tok = advance(state);
    delimiter = tok.value.replace(/^['"]|['"]$/g, ''); // strip quotes
  }

  // Heredoc body: 消费到分隔符行
  while (peek(state).type !== 'EOF') {
    const tok = peek(state);
    if (tok.type === 'WORD' && tok.value === delimiter) {
      advance(state);
      break;
    }
    advance(state);
  }

  return makeNode(state, NodeType.HEREDOC_REDIRECT, startIdx, peek(state).start, [
    makeNode(state, op.value, op.start, op.end),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// Compound Commands
// ═══════════════════════════════════════════════════════════════════════════

function parseSubshell(state: ParserState): TsNode {
  const startTok = expect(state, 'OP', '(');
  skipNewlines(state);
  const body = parseStatements(state);
  skipNewlines(state);
  const endTok = expect(state, 'OP', ')');
  return makeNode(state, NodeType.SUBSHELL, startTok.start, endTok.end, body);
}

function parseGroupCommand(state: ParserState): TsNode {
  const startTok = expect(state, 'OP', '{');
  skipNewlines(state);
  const body = parseStatements(state);
  skipNewlines(state);
  const endTok = expect(state, 'OP', '}');
  return makeNode(state, NodeType.COMPOUND_STATEMENT, startTok.start, endTok.end, body);
}

function parseIfStatement(state: ParserState): TsNode {
  const startTok = expect(state, 'WORD', 'if');
  const children: TsNode[] = [];

  // condition
  skipNewlines(state);
  children.push(...parseStatements(state));

  // then
  skipNewlines(state);
  expect(state, 'WORD', 'then');
  skipNewlines(state);
  children.push(...parseStatements(state));

  // elif / else
  while (peek(state).type === 'WORD') {
    if (peek(state).value === 'elif') {
      advance(state);
      skipNewlines(state);
      children.push(...parseStatements(state));
      skipNewlines(state);
      expect(state, 'WORD', 'then');
      skipNewlines(state);
      children.push(...parseStatements(state));
    } else if (peek(state).value === 'else') {
      advance(state);
      skipNewlines(state);
      children.push(...parseStatements(state));
    } else {
      break;
    }
  }

  skipNewlines(state);
  const endTok = expect(state, 'WORD', 'fi');
  return makeNode(state, NodeType.IF_STATEMENT, startTok.start, endTok.end, children);
}

function parseForStatement(state: ParserState): TsNode {
  const startTok = expect(state, 'WORD', 'for');
  const children: TsNode[] = [];

  // variable
  const varTok = advance(state);
  children.push(makeNode(state, NodeType.VARIABLE_NAME, varTok.start, varTok.end));

  // 'in' word...
  skipNewlines(state);
  if (peek(state).type === 'WORD' && peek(state).value === 'in') {
    advance(state);
    while (isWordToken(peek(state))) {
      children.push(parseWordNode(state));
    }
  }

  // separator
  if (peek(state).type === 'OP' && peek(state).value === ';') advance(state);
  skipNewlines(state);

  // do ... done
  expect(state, 'WORD', 'do');
  skipNewlines(state);
  children.push(...parseStatements(state));
  skipNewlines(state);
  const endTok = expect(state, 'WORD', 'done');

  return makeNode(state, NodeType.FOR_STATEMENT, startTok.start, endTok.end, children);
}

function parseWhileStatement(state: ParserState): TsNode {
  const keyword = advance(state); // 'while' or 'until'
  const children: TsNode[] = [];

  skipNewlines(state);
  children.push(...parseStatements(state));

  skipNewlines(state);
  expect(state, 'WORD', 'do');
  skipNewlines(state);
  children.push(...parseStatements(state));
  skipNewlines(state);
  const endTok = expect(state, 'WORD', 'done');

  return makeNode(state, NodeType.WHILE_STATEMENT, keyword.start, endTok.end, children);
}

function parseCaseStatement(state: ParserState): TsNode {
  const startTok = expect(state, 'WORD', 'case');
  const children: TsNode[] = [];

  // word
  if (isWordToken(peek(state))) {
    children.push(parseWordNode(state));
  }
  skipNewlines(state);
  expect(state, 'WORD', 'in');
  skipNewlines(state);

  // case items: pattern) body ;; — simplified, consume until esac
  while (peek(state).type !== 'EOF') {
    if (peek(state).type === 'WORD' && peek(state).value === 'esac') break;
    advance(state); // consume tokens until esac (simplified)
  }

  const endTok = expect(state, 'WORD', 'esac');
  return makeNode(state, NodeType.CASE_STATEMENT, startTok.start, endTok.end, children);
}

function parseFunctionDef(state: ParserState): TsNode {
  const startTok = expect(state, 'WORD', 'function');

  // function name
  const nameTok = advance(state);
  const children: TsNode[] = [
    makeNode(state, NodeType.WORD, nameTok.start, nameTok.end),
  ];

  // optional ()
  if (matchOp(state, '(')) {
    advance(state);
    expect(state, 'OP', ')');
  }

  skipNewlines(state);

  // body: { ... } or compound command
  children.push(parseCommand(state));

  const endIdx = children[children.length - 1].endIndex;
  return makeNode(state, NodeType.FUNCTION_DEFINITION, startTok.start, endIdx, children);
}
