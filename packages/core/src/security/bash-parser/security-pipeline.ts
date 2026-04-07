/**
 * 安全检查管线
 *
 * 统一入口: 整合 AST 分析 + Pre-checks + Sed 验证 + 变量追踪。
 * 实现 Deferred Result 优先级: misparsing 优先，non-misparsing 延迟。
 *
 * 参考 Claude Code src/tools/BashTool/bashSecurity.ts 4.1-4.4 节
 */

import type { SimpleCommand, ParseBudget } from './types.js';
import { DEFAULT_BUDGET } from './types.js';
import { analyzeCommand, type SecurityAnalysisResult } from './security-analyzer.js';
import { validateSedCommand, type SedValidationResult } from '../sed-validator.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PipelineResult {
  /** 最终判定 */
  decision: 'allow' | 'ask' | 'deny';
  /** 原因 */
  reason?: string;
  /** 是否 misparsing (解析器不可信) */
  isMisparsing: boolean;
  /** 提取的命令列表 */
  commands: SimpleCommand[];
  /** sed 验证结果 (如有) */
  sedResults?: SedValidationResult[];
  /** 底层安全分析结果 */
  analysis: SecurityAnalysisResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 运行完整安全检查管线
 *
 * @param command 原始 bash 命令
 * @param options 配置选项
 */
export function runSecurityPipeline(
  command: string,
  options: PipelineOptions = {},
): PipelineResult {
  const {
    budget = DEFAULT_BUDGET,
    allowFileWrites = false,
  } = options;

  // Step 1: 统一安全分析 (AST + pre-checks + var-scope)
  const analysis = analyzeCommand(command, budget);

  // Misparsing → 直接 ask
  if (analysis.kind === 'ask' && analysis.isMisparsing) {
    return {
      decision: 'ask',
      reason: analysis.reason,
      isMisparsing: true,
      commands: [],
      analysis,
    };
  }

  // too-complex / parse-unavailable → ask
  if (analysis.kind === 'ask' || analysis.kind === 'deny') {
    return {
      decision: analysis.kind === 'deny' ? 'deny' : 'ask',
      reason: analysis.reason,
      isMisparsing: false,
      commands: analysis.commands,
      analysis,
    };
  }

  // Step 2: Per-command 验证
  const sedResults: SedValidationResult[] = [];
  /** Deferred non-misparsing result (延迟返回) */
  let deferredAsk: { reason: string } | null = null;

  for (const cmd of analysis.commands) {
    const cmdName = cmd.argv[0]?.toLowerCase();

    // Sed 专项验证
    if (cmdName === 'sed') {
      const sedResult = validateSedCommand(cmd, allowFileWrites);
      sedResults.push(sedResult);
      if (!sedResult.safe) {
        // Sed 验证失败是 non-misparsing (解析正确但操作危险)
        if (!deferredAsk) {
          deferredAsk = { reason: sedResult.reason ?? 'sed 命令不安全' };
        }
      }
    }

    // TODO Sprint 5: 路径验证、只读命令验证在这里添加
  }

  // Step 3: 返回结果 (deferred result 优先级已在 pre-checks 中处理)
  if (deferredAsk) {
    return {
      decision: 'ask',
      reason: deferredAsk.reason,
      isMisparsing: false,
      commands: analysis.commands,
      sedResults,
      analysis,
    };
  }

  return {
    decision: 'allow',
    isMisparsing: false,
    commands: analysis.commands,
    sedResults,
    analysis,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════════════

export interface PipelineOptions {
  /** 解析器资源预算 */
  budget?: ParseBudget;
  /** 是否允许文件写入 (影响 sed -i) */
  allowFileWrites?: boolean;
}
