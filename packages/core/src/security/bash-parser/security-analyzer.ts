/**
 * Bash 命令安全分析器
 *
 * 整合 AST 解析 + 变量作用域追踪 + Pre-check 差异检测。
 * 白名单制 FAIL-CLOSED 架构 — 不确定就要求确认。
 *
 * 分析流程:
 * 1. Pre-checks (控制字符、Unicode 空白等)
 * 2. AST 解析 + SimpleCommand 提取
 * 3. 变量作用域追踪 + $VAR 解析
 * 4. 返回 SecurityAnalysisResult
 *
 * 参考 Claude Code src/utils/bash/ast.ts + bashSecurity.ts
 */

import type { SimpleCommand, ParseForSecurityResult, ParseBudget } from './types.js';
import { DEFAULT_BUDGET } from './types.js';
import { parseForSecurity } from './ast-extractor.js';
import { runPreChecks, type PreCheckResult } from './pre-checks.js';
import { resolveCommandVariables } from './var-scope.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SecurityAnalysisResult {
  /** 分析结果类型 */
  kind: 'safe' | 'ask' | 'deny';
  /** 提取的命令列表（变量已解析） */
  commands: SimpleCommand[];
  /** 原始 AST 解析结果 */
  parseResult: ParseForSecurityResult;
  /** Pre-check 结果 */
  preCheck: PreCheckResult;
  /** 需要用户确认的原因 */
  reason?: string;
  /** 是否是 misparsing 类问题（阻断 splitCommand 流程） */
  isMisparsing: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 对 bash 命令执行完整安全分析
 *
 * @param command 原始命令字符串
 * @param budget 解析器资源预算
 * @returns 安全分析结果
 */
export function analyzeCommand(
  command: string,
  budget: ParseBudget = DEFAULT_BUDGET,
): SecurityAnalysisResult {
  // 空命令 → safe
  if (!command.trim()) {
    return {
      kind: 'safe',
      commands: [],
      parseResult: { kind: 'simple', commands: [] },
      preCheck: { passed: true, isMisparsing: false },
      isMisparsing: false,
    };
  }

  // Step 1: Pre-checks — 捕获解析器与 bash 之间的差异
  const preCheck = runPreChecks(command);
  if (!preCheck.passed) {
    if (preCheck.isMisparsing) {
      // Misparsing — 解析器不可信，直接要求确认
      return {
        kind: 'ask',
        commands: [],
        parseResult: { kind: 'too-complex', reason: preCheck.reason ?? 'pre-check failed' },
        preCheck,
        reason: preCheck.reason,
        isMisparsing: true,
      };
    }
    // Non-misparsing — 记录，继续分析（可能被后续 misparsing 覆盖）
    // 延迟处理在返回时决定
  }

  // Step 2: AST 解析 + SimpleCommand 提取
  const parseResult = parseForSecurity(command, budget);

  if (parseResult.kind === 'too-complex') {
    return {
      kind: 'ask',
      commands: [],
      parseResult,
      preCheck,
      reason: parseResult.reason,
      isMisparsing: false,
    };
  }

  if (parseResult.kind === 'parse-unavailable') {
    return {
      kind: 'ask',
      commands: [],
      parseResult,
      preCheck,
      reason: '解析器不可用',
      isMisparsing: false,
    };
  }

  // Step 3: 变量作用域追踪
  const resolvedCommands = resolveCommandVariables(parseResult.commands);

  // Step 4: 子命令数量保护 (防 ReDoS)
  if (resolvedCommands.length > MAX_SUBCOMMANDS) {
    return {
      kind: 'ask',
      commands: resolvedCommands.slice(0, MAX_SUBCOMMANDS),
      parseResult,
      preCheck,
      reason: `命令包含 ${resolvedCommands.length} 个子命令（超过上限 ${MAX_SUBCOMMANDS}）`,
      isMisparsing: false,
    };
  }

  // Step 5: 返回结果（如果 pre-check 有 non-misparsing 警告，附带原因）
  if (!preCheck.passed) {
    return {
      kind: 'ask',
      commands: resolvedCommands,
      parseResult,
      preCheck,
      reason: preCheck.reason,
      isMisparsing: false,
    };
  }

  return {
    kind: 'safe',
    commands: resolvedCommands,
    parseResult,
    preCheck,
    isMisparsing: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 子命令上限 (防 ReDoS 和事件循环饥饿) — 参考 Claude Code */
const MAX_SUBCOMMANDS = 50;
