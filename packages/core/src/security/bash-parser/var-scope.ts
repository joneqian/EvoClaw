/**
 * 变量作用域追踪
 *
 * 跨命令追踪变量赋值，根据连接符决定作用域传播规则:
 * - && 和 ; → 共享作用域（顺序执行，变量可见）
 * - || 右侧 → 快照重置（条件执行，变量可能未设置）
 * - | 管道 → 隔离作用域（运行在子 shell 中）
 * - & 后台 → 隔离作用域（运行在子 shell 中）
 *
 * 防御标志遗漏攻击:
 *   true || FLAG=--dry-run && cmd $FLAG
 *   → bash 跳过 || 右侧（FLAG 未设置），cmd 无 --dry-run
 *   → 如果线性传播，argv 会是 ['cmd','--dry-run'] — 看起来安全实际危险
 *
 * 参考 Claude Code src/utils/bash/ast.ts 3.5 节
 */

import type { SimpleCommand } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** 变量值 — 可能是字面值、占位符或未知 */
export type VarValue =
  | { kind: 'literal'; value: string }
  | { kind: 'cmdsub' }        // 来自命令替换 $()
  | { kind: 'unknown' };      // 无法确定

/** 变量作用域 */
export class VarScope {
  private vars = new Map<string, VarValue>();

  /** 设置变量 */
  set(name: string, value: VarValue): void {
    this.vars.set(name, value);
  }

  /** 获取变量值 */
  get(name: string): VarValue | undefined {
    return this.vars.get(name);
  }

  /** 解析 $VAR 引用 — 返回字面值或占位符标记 */
  resolve(varRef: string): string {
    // $VAR or ${VAR} → 提取变量名
    const name = extractVarName(varRef);
    if (!name) return varRef; // 无法提取，返回原始

    const val = this.vars.get(name);
    if (!val) return varRef; // 未知变量，保留原始
    if (val.kind === 'literal') return val.value;
    if (val.kind === 'cmdsub') return '__CMDSUB__';
    return '__UNKNOWN__';
  }

  /** 创建快照（用于 || 分支重置） */
  snapshot(): VarScope {
    const clone = new VarScope();
    for (const [k, v] of this.vars) {
      clone.vars.set(k, v);
    }
    return clone;
  }

  /** 创建隔离作用域（用于管道/后台） */
  static isolated(): VarScope {
    return new VarScope();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Scope Propagation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 根据连接符决定下一个命令的作用域
 *
 * @param current 当前作用域
 * @param snapshotBeforeOr || 之前的快照（用于重置）
 * @param separator 连接符
 * @returns [下一命令的作用域, 新的 snapshotBeforeOr]
 */
export function propagateScope(
  current: VarScope,
  snapshotBeforeOr: VarScope | null,
  separator: SimpleCommand['separator'],
): [VarScope, VarScope | null] {
  switch (separator) {
    case '&&':
    case ';':
    case undefined:
      // 顺序执行 — 共享作用域
      return [current, snapshotBeforeOr];

    case '||':
      // 条件执行 — 右侧重置到 || 之前的快照
      // 保存当前作用域作为后续 && 的基础
      return [
        snapshotBeforeOr?.snapshot() ?? current.snapshot(),
        snapshotBeforeOr ?? current.snapshot(),
      ];

    case '|':
    case '|&':
      // 管道 — 隔离作用域（子 shell）
      return [VarScope.isolated(), null];

    case '&':
      // 后台 — 隔离作用域
      return [VarScope.isolated(), null];

    default:
      return [current, snapshotBeforeOr];
  }
}

/**
 * 在命令列表上执行作用域追踪，解析变量引用
 *
 * 返回带有解析后 argv 的命令列表（$VAR 替换为已知值或占位符）
 *
 * 安全关键: || 右侧的赋值不应传播到后续 && 链。
 * 因为 bash 在左侧成功时跳过 || 右侧，变量实际未设置。
 *
 * 模型:
 * - && ; 中的赋值: 正常传播（一定会执行）
 * - || 右侧的赋值: 在隔离快照中执行，不影响后续作用域
 * - | & 中的赋值: 完全隔离
 */
export function resolveCommandVariables(commands: readonly SimpleCommand[]): SimpleCommand[] {
  let scope = new VarScope();
  let snapshotBeforeOr: VarScope | null = null;
  /** 标记当前命令是否在 || 右侧（赋值不应传播） */
  let inOrBranch = false;

  return commands.map((cmd) => {
    // 传播作用域
    if (cmd.separator === '||') {
      // 进入 || 右侧: 保存快照，在快照上操作
      snapshotBeforeOr = scope.snapshot();
      scope = scope.snapshot(); // 工作在副本上
      inOrBranch = true;
    } else if (cmd.separator === '&&' || cmd.separator === ';') {
      if (inOrBranch && snapshotBeforeOr) {
        // || 右侧结束，回到 || 之前的状态
        scope = snapshotBeforeOr;
        snapshotBeforeOr = null;
        inOrBranch = false;
      }
      // && ; 共享作用域
    } else if (cmd.separator === '|' || cmd.separator === '|&' || cmd.separator === '&') {
      // 管道/后台: 隔离
      scope = VarScope.isolated();
      snapshotBeforeOr = null;
      inOrBranch = false;
    }

    // 先解析 argv（在赋值之前，使用当前作用域）
    const resolvedArgv = cmd.argv.map(arg => {
      if (arg.startsWith('$')) {
        return scope.resolve(arg);
      }
      return arg;
    });

    // 再记录环境变量赋值（影响后续命令）
    for (const { name, value } of cmd.envVars) {
      if (value.startsWith('$(') || value.startsWith('`')) {
        scope.set(name, { kind: 'cmdsub' });
      } else {
        scope.set(name, { kind: 'literal', value });
      }
    }

    return { ...cmd, argv: resolvedArgv };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** 从 $VAR 或 ${VAR} 中提取变量名 */
function extractVarName(ref: string): string | null {
  if (ref.startsWith('${') && ref.endsWith('}')) {
    // ${VAR} or ${VAR:-default} — 只取变量名部分
    const inner = ref.slice(2, -1);
    const match = inner.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    return match?.[1] ?? null;
  }
  if (ref.startsWith('$')) {
    const match = ref.slice(1).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
    return match?.[1] ?? null;
  }
  return null;
}

/** 导出供测试 */
export const _testing = { extractVarName };
