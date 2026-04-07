/**
 * AST → SimpleCommand[] 提取器
 *
 * 遍历 AST，将简单命令提取为标准化的 SimpleCommand 结构。
 * 白名单制: 只处理已知安全的节点类型，未知节点 → too-complex。
 *
 * 参考 Claude Code src/utils/bash/ast.ts
 */

import type { TsNode, SimpleCommand, Redirect, ParseForSecurityResult } from './types.js';
import { NodeType } from './types.js';
import { parse } from './parser.js';
import type { ParseBudget } from './types.js';
import { DEFAULT_BUDGET } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Node Classification — 白名单制 FAIL-CLOSED
// ═══════════════════════════════════════════════════════════════════════════

/** 结构节点 — 递归遍历子节点 */
const STRUCTURAL_TYPES: ReadonlySet<string> = new Set([
  NodeType.PROGRAM,
  NodeType.LIST,
  NodeType.PIPELINE,
  NodeType.REDIRECTED_STATEMENT,
  NodeType.NEGATED_COMMAND,
]);

/** 危险节点类型 — 显式标记为不安全 (安全性靠白名单，不靠黑名单) */
const DANGEROUS_TYPES: ReadonlySet<string> = new Set([
  NodeType.COMMAND_SUBSTITUTION,    // $()
  NodeType.PROCESS_SUBSTITUTION,    // <() >()
  NodeType.EXPANSION,               // ${}
  NodeType.SUBSHELL,                // (...)
  NodeType.COMPOUND_STATEMENT,      // { ...; }
  NodeType.FOR_STATEMENT,
  NodeType.WHILE_STATEMENT,
  NodeType.IF_STATEMENT,
  NodeType.CASE_STATEMENT,
  NodeType.FUNCTION_DEFINITION,
  NodeType.TEST_COMMAND,
  NodeType.ARITHMETIC_EXPANSION,
]);

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 解析命令并提取 SimpleCommand[]
 */
export function parseForSecurity(
  command: string,
  budget: ParseBudget = DEFAULT_BUDGET,
): ParseForSecurityResult {
  const result = parse(command, budget);

  if (!result.ok) {
    if (result.reason === 'timeout' || result.reason === 'budget') {
      return { kind: 'too-complex', reason: result.message };
    }
    return { kind: 'too-complex', reason: `parse error: ${result.message}` };
  }

  try {
    const commands = extractSimpleCommands(result.root);
    return { kind: 'simple', commands };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'too-complex', reason: msg };
  }
}

/**
 * 从 AST 提取 SimpleCommand 列表
 */
export function extractSimpleCommands(root: TsNode): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  walkNode(root, commands, undefined);
  return commands;
}

// ═══════════════════════════════════════════════════════════════════════════
// AST Walker
// ═══════════════════════════════════════════════════════════════════════════

function walkNode(
  node: TsNode,
  commands: SimpleCommand[],
  separator: SimpleCommand['separator'],
): void {
  // 简单命令 — 提取 argv + envVars + redirects
  if (node.type === NodeType.SIMPLE_COMMAND) {
    commands.push(extractCommand(node, separator));
    return;
  }

  // 结构节点 — 递归遍历
  if (STRUCTURAL_TYPES.has(node.type)) {
    let nextSep: SimpleCommand['separator'] = separator;

    for (const child of node.children) {
      // 分隔符节点: &&, ||, |, ;, &, |&
      if (isSeparatorNode(child)) {
        nextSep = child.type as SimpleCommand['separator'];
        continue;
      }
      walkNode(child, commands, nextSep);
      nextSep = undefined;
    }
    return;
  }

  // 危险节点 — 直接报 too-complex
  if (DANGEROUS_TYPES.has(node.type)) {
    throw new Error(`too-complex: dangerous node type '${node.type}'`);
  }

  // 叶子/word 节点 — 忽略 (不产生命令)
  if (isLeafNode(node)) {
    return;
  }

  // 未知节点 — FAIL-CLOSED
  throw new Error(`too-complex: unknown node type '${node.type}'`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Command Extraction
// ═══════════════════════════════════════════════════════════════════════════

function extractCommand(node: TsNode, separator: SimpleCommand['separator']): SimpleCommand {
  const argv: string[] = [];
  const envVars: Array<{ name: string; value: string }> = [];
  const redirects: Redirect[] = [];
  let inArgs = false;

  for (const child of node.children) {
    // 变量赋值 (只在命令开头)
    if (child.type === NodeType.VARIABLE_ASSIGNMENT && !inArgs) {
      const eqIdx = child.text.indexOf('=');
      envVars.push({
        name: child.text.slice(0, eqIdx),
        value: child.text.slice(eqIdx + 1),
      });
      continue;
    }

    // 重定向
    if (child.type === NodeType.FILE_REDIRECT || child.type === NodeType.HEREDOC_REDIRECT) {
      redirects.push(extractRedirect(child));
      continue;
    }

    // 命令字/参数
    if (isWordLikeNode(child)) {
      inArgs = true;
      argv.push(resolveWordValue(child));
      continue;
    }

    // 嵌套的危险节点 (如命令替换作为参数)
    if (DANGEROUS_TYPES.has(child.type)) {
      throw new Error(`too-complex: dangerous node '${child.type}' in command`);
    }
  }

  return { argv, envVars, redirects, text: node.text, separator };
}

function extractRedirect(node: TsNode): Redirect {
  let operator = '';
  let target = '';
  let fd: number | undefined;

  for (const child of node.children) {
    if (child.type === NodeType.WORD && /^\d+$/.test(child.text) && !operator) {
      fd = parseInt(child.text, 10);
    } else if (isRedirectOpType(child.type)) {
      operator = child.type;
    } else {
      target = resolveWordValue(child);
    }
  }

  return { operator, target, fd };
}

function isRedirectOpType(type: string): boolean {
  return ['>', '>>', '<', '>&', '<&', '&>', '&>>'].includes(type);
}

/** 解析 word 节点的文本值 (去除引号等) */
function resolveWordValue(node: TsNode): string {
  switch (node.type) {
    case NodeType.RAW_STRING:
      // 去除单引号: 'hello' → hello
      return node.text.slice(1, -1);
    case NodeType.STRING:
      // 去除双引号: "hello" → hello
      return node.text.slice(1, -1);
    case NodeType.SIMPLE_EXPANSION:
      // $VAR → 保留原始 (安全分析不展开变量)
      return node.text;
    case NodeType.WORD:
      return node.text;
    default:
      return node.text;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Node Type Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isSeparatorNode(node: TsNode): boolean {
  return ['&&', '||', '|', ';', '&', '|&', '\n'].includes(node.type);
}

function isLeafNode(node: TsNode): boolean {
  return node.type === NodeType.WORD ||
    node.type === NodeType.RAW_STRING ||
    node.type === NodeType.STRING ||
    node.type === NodeType.STRING_CONTENT ||
    node.type === NodeType.SIMPLE_EXPANSION ||
    node.type === NodeType.VARIABLE_NAME ||
    node.type === NodeType.VARIABLE_ASSIGNMENT ||
    node.type === NodeType.COMMENT ||
    node.type === NodeType.FILE_REDIRECT ||
    node.type === NodeType.HEREDOC_REDIRECT ||
    node.type === NodeType.CONCATENATION;
}

function isWordLikeNode(node: TsNode): boolean {
  return node.type === NodeType.WORD ||
    node.type === NodeType.RAW_STRING ||
    node.type === NodeType.STRING ||
    node.type === NodeType.SIMPLE_EXPANSION ||
    node.type === NodeType.CONCATENATION;
}
