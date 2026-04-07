/**
 * Bash 解析器公开 API
 *
 * 用法:
 * ```ts
 * import { parseBash, parseForSecurity } from './security/bash-parser/index.js';
 *
 * const result = parseBash('ls -la | grep foo');
 * if (result.ok) console.log(result.root);
 *
 * const secResult = parseForSecurity('echo hello && rm -rf /');
 * if (secResult.kind === 'simple') {
 *   for (const cmd of secResult.commands) {
 *     console.log(cmd.argv);
 *   }
 * }
 * ```
 */

export { parse as parseBash } from './parser.js';
export { tokenize } from './tokenizer.js';
export { extractSimpleCommands, parseForSecurity } from './ast-extractor.js';
export { analyzeCommand } from './security-analyzer.js';
export { runPreChecks } from './pre-checks.js';
export { VarScope, resolveCommandVariables, propagateScope } from './var-scope.js';
export { runSecurityPipeline } from './security-pipeline.js';

export type {
  TsNode,
  Token,
  TokenType,
  SimpleCommand,
  Redirect,
  ParseForSecurityResult,
  ParseResult,
  ParseBudget,
} from './types.js';

export type { SecurityAnalysisResult } from './security-analyzer.js';
export type { PreCheckResult } from './pre-checks.js';
export type { VarValue } from './var-scope.js';
export type { PipelineResult, PipelineOptions } from './security-pipeline.js';
export type { SedValidationResult } from '../sed-validator.js';

export { NodeType, SEPARATOR_TYPES, DEFAULT_BUDGET } from './types.js';
