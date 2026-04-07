/**
 * 命令路径提取器 — 从 shell 命令中提取文件/目录路径参数
 *
 * 参考 Claude Code pathValidation.ts PATH_EXTRACTORS 设计:
 * - 每种命令有专用提取逻辑（理解 flag 参数）
 * - POSIX `--` 处理（之后所有参数视为位置参数）
 * - Tilde 展开（仅 ~/）
 * - Glob 基目录提取
 */

import path from 'node:path';
import os from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** flag 参数类型 — 决定 flag 后是否吃掉下一个 token */
type FlagArgType = 'none' | 'string' | 'number';

// ═══════════════════════════════════════════════════════════════════════════
// POSIX -- 与 flag 过滤
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 过滤 flag，保留位置参数（即路径参数）
 * 正确处理 POSIX `--`（之后所有参数视为位置参数）
 */
function filterOutFlags(args: string[], flagsWithArgs: Record<string, FlagArgType> = {}): string[] {
  const result: string[] = [];
  let afterDash = false;
  let skipNext = false;

  for (let i = 0; i < args.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const arg = args[i]!;

    // `--` 之后所有参数视为位置参数
    if (arg === '--') {
      afterDash = true;
      continue;
    }

    if (afterDash) {
      result.push(arg);
      continue;
    }

    // 短 flag 或长 flag
    if (arg.startsWith('-')) {
      // 检查是否是带参数的 flag
      const flagKey = arg.replace(/^-+/, '');
      if (flagsWithArgs[arg] && flagsWithArgs[arg] !== 'none') {
        skipNext = true; // 吃掉下一个 token
      } else if (flagsWithArgs[`-${flagKey}`] && flagsWithArgs[`-${flagKey}`] !== 'none') {
        skipNext = true;
      }
      // 跳过 flag 本身
      continue;
    }

    result.push(arg);
  }

  return result;
}

/**
 * 从 grep/rg 类命令提取路径（第一个位置参数是 pattern，后续是路径）
 */
function parsePatternCommand(args: string[], flagsWithArgs: Record<string, FlagArgType>): string[] {
  const positional = filterOutFlags(args, flagsWithArgs);
  // 第一个位置参数是 pattern，其余是路径
  return positional.slice(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// 命令路径提取器注册表
// ═══════════════════════════════════════════════════════════════════════════

const GREP_FLAGS_WITH_ARGS: Record<string, FlagArgType> = {
  '-e': 'string', '-f': 'string', '-m': 'number', '--max-count': 'number',
  '-A': 'number', '-B': 'number', '-C': 'number', '--color': 'string',
  '--include': 'string', '--exclude': 'string', '--exclude-dir': 'string',
};

const FIND_FLAGS_WITH_ARGS: Record<string, FlagArgType> = {
  '-name': 'string', '-iname': 'string', '-path': 'string', '-ipath': 'string',
  '-type': 'string', '-maxdepth': 'number', '-mindepth': 'number',
  '-newer': 'string', '-user': 'string', '-group': 'string',
  '-exec': 'string', '-execdir': 'string',
};

/** 每种命令的路径提取逻辑 */
const PATH_EXTRACTORS: Record<string, (args: string[]) => string[]> = {
  // 文件操作
  cd:    (args) => args.length === 0 ? [os.homedir()] : filterOutFlags(args),
  ls:    (args) => filterOutFlags(args).length > 0 ? filterOutFlags(args) : ['.'],
  cat:   (args) => filterOutFlags(args, { '-n': 'none' }),
  head:  (args) => filterOutFlags(args, { '-n': 'number', '-c': 'number' }),
  tail:  (args) => filterOutFlags(args, { '-n': 'number', '-c': 'number', '-f': 'none' }),
  wc:    (args) => filterOutFlags(args),
  file:  (args) => filterOutFlags(args),
  stat:  (args) => filterOutFlags(args),
  sort:  (args) => filterOutFlags(args, { '-k': 'string', '-t': 'string', '-o': 'string' }),
  uniq:  (args) => filterOutFlags(args, { '-c': 'none', '-d': 'none' }),
  diff:  (args) => filterOutFlags(args),

  // 目录操作
  mkdir: (args) => filterOutFlags(args, { '-m': 'string' }),
  touch: (args) => filterOutFlags(args, { '-t': 'string', '-d': 'string', '-r': 'string' }),

  // 危险文件操作
  rm:    (args) => filterOutFlags(args),
  rmdir: (args) => filterOutFlags(args),
  mv:    (args) => filterOutFlags(args, { '-t': 'string' }),
  cp:    (args) => filterOutFlags(args, { '-t': 'string' }),
  chmod: (args) => filterOutFlags(args).slice(1), // 第一个位置参数是 mode

  // 搜索
  find:  (args) => {
    // find 的第一个位置参数是路径
    const positional = filterOutFlags(args, FIND_FLAGS_WITH_ARGS);
    return positional.length > 0 ? [positional[0]!] : ['.'];
  },
  grep:  (args) => parsePatternCommand(args, GREP_FLAGS_WITH_ARGS),
  rg:    (args) => parsePatternCommand(args, GREP_FLAGS_WITH_ARGS),

  // Git（提取 -C 之后的目录，以及操作的文件路径）
  git:   (args) => {
    const paths: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-C' && i + 1 < args.length) {
        paths.push(args[i + 1]!);
        i++;
      }
    }
    return paths;
  },

  // sed（提取 -i 目标文件路径）
  sed:   (args) => {
    const result: string[] = [];
    let afterExpression = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === '-e' || arg === '-f') {
        i++; // 跳过表达式/脚本
        afterExpression = true;
        continue;
      }
      if (arg.startsWith('-')) continue;
      if (!afterExpression) {
        afterExpression = true; // 第一个位置参数是表达式
        continue;
      }
      result.push(arg);
    }
    return result;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 从命令 argv 中提取路径参数
 *
 * @param commandName 命令名称（argv[0] 的 basename）
 * @param args 命令参数（argv[1:]）
 * @returns 提取的路径列表（未展开的原始路径）
 */
export function extractPaths(commandName: string, args: string[]): string[] {
  const extractor = PATH_EXTRACTORS[commandName];
  if (!extractor) return [];
  return extractor(args);
}

/**
 * 展开 tilde（仅 ~/ 和 ~，不支持 ~username）
 */
export function expandTilde(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * 提取 glob 模式的基目录
 * "/path/to/*.txt" → "/path/to"
 * "/path/to/file.ts" → null (不是 glob)
 */
export function getGlobBaseDirectory(filePath: string): string | null {
  if (!/[*?[\]{}]/.test(filePath)) return null;

  const idx = filePath.search(/[*?[\]{}]/);
  const prefix = filePath.slice(0, idx);
  const lastSep = prefix.lastIndexOf('/');
  return lastSep >= 0 ? prefix.slice(0, lastSep) || '/' : '.';
}

/**
 * 检测路径是否包含路径穿越（检查原始字符串中的 .. 序列）
 */
export function containsPathTraversal(filePath: string): boolean {
  // 检查原始路径中是否含 .. 组件（path.normalize 会消除 ..）
  return /(^|[\\/])\.\.($|[\\/])/.test(filePath);
}

/** 导出 filterOutFlags 供测试 */
export { filterOutFlags };
