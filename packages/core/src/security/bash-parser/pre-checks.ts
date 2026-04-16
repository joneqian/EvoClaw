/**
 * Pre-check 差异检测
 *
 * 在 AST 分析前运行正则预检查，捕获解析器和 bash 之间已知的解析差异。
 * 这些差异可能导致安全工具对命令的理解与 bash 实际执行不同。
 *
 * 参考 Claude Code src/utils/bash/ast.ts 3.6 节
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PreCheckResult {
  /** 是否通过所有预检查 */
  passed: boolean;
  /** 失败原因 */
  reason?: string;
  /** 是否属于 misparsing 类（解析器会误解命令） */
  isMisparsing: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pre-check Validators
// ═══════════════════════════════════════════════════════════════════════════

interface PreCheck {
  name: string;
  /** true = misparsing（解析器误解），false = non-misparsing（解析正确但需确认） */
  isMisparsing: boolean;
  test: (command: string) => string | null;
}

const PRE_CHECKS: readonly PreCheck[] = [
  // ─── Misparsing checks ───
  {
    name: 'control_characters',
    isMisparsing: true,
    test: (cmd) => {
      // 控制字符 (除 \t \n \r): bash 静默丢弃，解析器视为分隔符
      // 故意包含控制字符作为安全检查 pattern
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(cmd)) {
        return '命令包含控制字符';
      }
      return null;
    },
  },
  {
    name: 'unicode_whitespace',
    isMisparsing: true,
    test: (cmd) => {
      // Unicode 空白字符: 终端中不可见，bash 视为普通字符
      if (/[\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]/.test(cmd)) {
        return '命令包含 Unicode 不可见空白字符';
      }
      return null;
    },
  },
  {
    name: 'backslash_whitespace',
    isMisparsing: true,
    test: (cmd) => {
      // 反斜杠+空白在非引号上下文: 解析器和 bash 对 "\ " 的解析不同
      // 只在非引号上下文中检查（简化: 检查不在引号内的 \<space>）
      const stripped = stripQuotedRegions(cmd);
      if (/\\\s/.test(stripped)) {
        return '命令包含反斜杠转义空白（解析器可能误解）';
      }
      return null;
    },
  },
  {
    name: 'backslash_operators',
    isMisparsing: true,
    test: (cmd) => {
      // 反斜杠+操作符: 如 \; 导致解析器与 bash 解析不同
      const stripped = stripQuotedRegions(cmd);
      if (/\\[;&|><()]/.test(stripped)) {
        return '命令包含反斜杠转义操作符（解析器可能误解）';
      }
      return null;
    },
  },
  {
    name: 'zsh_tilde_expansion',
    isMisparsing: true,
    test: (cmd) => {
      // Zsh ~[name] 动态命名目录展开，可执行任意代码
      if (/~\[[^\]]+\]/.test(cmd)) {
        return '命令包含 Zsh 动态目录展开 ~[name]';
      }
      return null;
    },
  },
  {
    name: 'zsh_equals_expansion',
    isMisparsing: true,
    test: (cmd) => {
      // Zsh =cmd 展开为命令绝对路径
      if (/(?:^|\s)=[a-zA-Z]/.test(cmd)) {
        return '命令包含 Zsh 路径展开 =cmd';
      }
      return null;
    },
  },

  // ─── Non-misparsing checks ───
  {
    name: 'newlines',
    isMisparsing: false,
    test: (cmd) => {
      // 命令中的换行可能隐藏恶意意图
      const stripped = stripQuotedRegions(cmd);
      if (stripped.includes('\n')) {
        return '命令包含换行符';
      }
      return null;
    },
  },
  {
    name: 'carriage_return',
    isMisparsing: false,
    test: (cmd) => {
      // 回车符 (CR) 可在终端中覆盖显示内容
      if (cmd.includes('\r')) {
        return '命令包含回车符 (\\r)';
      }
      return null;
    },
  },
  {
    name: 'brace_expansion_with_quotes',
    isMisparsing: false,
    test: (cmd) => {
      // 花括号展开+引号混合可能混淆检测
      const stripped = stripQuotedRegions(cmd);
      if (/\{[^}]*,[^}]*\}/.test(stripped)) {
        return '命令包含花括号展开';
      }
      return null;
    },
  },
  {
    name: 'ifs_injection',
    isMisparsing: false,
    test: (cmd) => {
      // IFS 环境变量注入可改变字段分隔行为
      if (/\bIFS\s*=/.test(cmd)) {
        return '命令设置了 IFS 变量（可改变字段分隔行为）';
      }
      return null;
    },
  },
  {
    name: 'comment_quote_desync',
    isMisparsing: false,
    test: (cmd) => {
      // 注释和引号不同步: #"... 或 '...# 可能导致解析混淆
      const stripped = stripQuotedRegions(cmd);
      // 检查 # 后面是否有未闭合引号
      const hashIdx = stripped.indexOf('#');
      if (hashIdx >= 0) {
        const afterHash = cmd.slice(hashIdx);
        const singleCount = (afterHash.match(/'/g) ?? []).length;
        const doubleCount = (afterHash.match(/"/g) ?? []).length;
        if (singleCount % 2 !== 0 || doubleCount % 2 !== 0) {
          return '命令中注释与引号不同步';
        }
      }
      return null;
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 运行所有预检查
 *
 * Deferred Result 优先级机制:
 * - non-misparsing 结果延迟
 * - 继续运行后续验证器
 * - 如果任何 misparsing 验证器触发，返回那个（带标志的）结果
 * - 只有最后才返回延迟的 non-misparsing 结果
 */
export function runPreChecks(command: string): PreCheckResult {
  let deferredNonMisparsing: PreCheckResult | null = null;

  for (const check of PRE_CHECKS) {
    const reason = check.test(command);
    if (reason !== null) {
      if (check.isMisparsing) {
        // Misparsing — 立即返回，优先级最高
        return { passed: false, reason, isMisparsing: true };
      }
      // Non-misparsing — 延迟，继续检查
      if (deferredNonMisparsing === null) {
        deferredNonMisparsing = { passed: false, reason, isMisparsing: false };
      }
    }
  }

  if (deferredNonMisparsing !== null) {
    return deferredNonMisparsing;
  }

  return { passed: true, isMisparsing: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 移除引号包围的区域（简化版）
 * 将 '...' 和 "..." 中的内容替换为空格占位符
 */
function stripQuotedRegions(cmd: string): string {
  let result = '';
  let i = 0;
  while (i < cmd.length) {
    const ch = cmd[i];

    if (ch === "'") {
      // 跳过单引号内容
      i++;
      while (i < cmd.length && cmd[i] !== "'") i++;
      if (i < cmd.length) i++; // skip closing '
      result += ' '; // 占位符
      continue;
    }

    if (ch === '"') {
      // 跳过双引号内容（处理转义）
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\') i++;
        i++;
      }
      if (i < cmd.length) i++; // skip closing "
      result += ' '; // 占位符
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

/** 导出供测试 */
export const _testing = { stripQuotedRegions, PRE_CHECKS };
