/**
 * 命令 flag 级白名单 — 收窄 SafeBins 攻击面
 *
 * SafeBins 原先只检查命令名，导致 `git push --force` 也自动放行。
 * 本模块为高频危险命令增加 flag 级检查:
 * - 危险 flag 触发 ask
 * - 危险参数模式触发 ask
 * - 未在白名单中的命令退回 SafeBins 行为
 *
 * 参考 Claude Code readOnlyValidation.ts COMMAND_ALLOWLIST
 */

/** flag 级检查结果 */
export type FlagCheckResult = 'safe' | 'ask' | 'skip';

/** 命令 flag 配置 */
interface CommandFlagConfig {
  /** 危险 flag（匹配到任一则触发 ask） */
  dangerousFlags: string[];
  /** 危险参数模式（对全命令匹配） */
  dangerousPatterns?: RegExp[];
}

/** 高频危险命令的 flag 级白名单 */
const COMMAND_FLAG_CONFIGS: Record<string, CommandFlagConfig> = {
  git: {
    dangerousFlags: [
      '--force', '-f',            // git push --force
      '--hard',                    // git reset --hard
      '--no-verify',               // 跳过 hooks
      '--amend',                   // git commit --amend
    ],
    dangerousPatterns: [
      /git\s+push\s+.*--force/i,
      /git\s+push\s+.*-f\b/i,
      /git\s+reset\s+--hard/i,
      /git\s+clean\s+-[a-z]*f/i,  // git clean -f/-fd/-fx
      /git\s+checkout\s+\./i,
      /git\s+branch\s+-[Dd]/i,    // git branch -D (强制删除分支)
    ],
  },
  rm: {
    dangerousFlags: [
      '-rf', '-fr', '-r', '-f',
      '--recursive', '--force',
    ],
    dangerousPatterns: [
      /rm\s+-[a-z]*r/i,           // 任何含 -r 的组合
    ],
  },
  sed: {
    dangerousFlags: [
      '-i', '--in-place',         // 就地编辑（写操作）
    ],
  },
  chmod: {
    dangerousFlags: [],
    dangerousPatterns: [
      /chmod\s+777/,              // 全权限
      /chmod\s+a\+w/,             // 所有人可写
      /chmod\s+-R\s+777/,         // 递归全权限
    ],
  },
  mv: {
    dangerousFlags: [],
    dangerousPatterns: [
      /mv\s+.*\s+\/dev\//,        // 移动到 /dev/
    ],
  },
  cp: {
    dangerousFlags: [],
    dangerousPatterns: [
      /cp\s+.*\/dev\//,           // 从/到 /dev/
    ],
  },
};

/**
 * 对命令做 flag 级安全检查
 *
 * @param command 完整命令字符串
 * @returns 'safe' 通过, 'ask' 需要确认, 'skip' 不在白名单中（退回 SafeBins 行为）
 */
export function checkCommandFlags(command: string): FlagCheckResult {
  const trimmed = command.trim();
  if (!trimmed) return 'skip';

  // 提取 base command（处理 cd 前缀和路径前缀）
  const firstCmd = trimmed.replace(/^cd\s+[^\s;|&]+\s*[;&|]+\s*/, '');
  const tokens = firstCmd.split(/\s+/);
  const bin = tokens[0] ?? '';
  const baseBin = bin.split('/').pop() ?? bin;

  const config = COMMAND_FLAG_CONFIGS[baseBin];
  if (!config) return 'skip'; // 不在 flag 白名单中

  // 检查危险 flag
  for (const flag of config.dangerousFlags) {
    if (tokens.includes(flag)) {
      return 'ask';
    }
    // 处理组合 flag（如 -rf）
    for (const token of tokens) {
      if (token.startsWith('-') && !token.startsWith('--') && token.includes(flag.replace('-', ''))) {
        return 'ask';
      }
    }
  }

  // 检查危险参数模式
  if (config.dangerousPatterns) {
    for (const pattern of config.dangerousPatterns) {
      if (pattern.test(command)) {
        return 'ask';
      }
    }
  }

  return 'safe';
}
