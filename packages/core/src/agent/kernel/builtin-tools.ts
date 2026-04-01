/**
 * 内置文件工具 — 替代 PI 的 codingTools + grepTool + findTool + lsTool
 *
 * 工具列表:
 * - read: 读取文件内容 (cat -n 格式行号, 图片 base64, offset/limit)
 * - write: 创建/覆盖文件 (自动创建父目录)
 * - edit: 精确字符串替换 (唯一性验证, replace_all, 引号规范化)
 * - grep: 搜索文件内容 (ripgrep / grep -rn 回退)
 * - find: 按 glob 模式搜索文件路径
 * - ls: 列出目录内容
 *
 * 参考 Claude Code:
 * - FileReadTool: docs/research/10-file-tools.md
 * - FileEditTool: 三步匹配降级 (精确 → 引号规范化 → XML 反消毒)
 *
 * 核心原则: 严格匹配 PI 的输出格式，避免模型行为偏移
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { KernelTool, ToolCallResult } from './types.js';
import { FileStateCache } from './file-state-cache.js';


// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 自适应最大读取字节数上限 (512KB) */
const MAX_ADAPTIVE_BYTES = 512 * 1024;

/** context window 中分配给单次读取的比例 */
const CONTEXT_SHARE = 0.2;

/** 平均每 token 的字符数 */
const CHARS_PER_TOKEN = 4;

/** 图片文件扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);

// ═══════════════════════════════════════════════════════════════════════════
// Safety Constants — P0-3/P0-5 安全防护
// ═══════════════════════════════════════════════════════════════════════════

/** P0-3: 阻止读取的危险设备路径 (参考 Claude Code FileReadTool) */
const BLOCKED_READ_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
  '/dev/stdin', '/dev/tty', '/dev/console',
  '/dev/stdout', '/dev/stderr',
  '/dev/fd/0', '/dev/fd/1', '/dev/fd/2',
]);

/** P0-3: 阻止读取的危险路径正则 */
const BLOCKED_READ_PATH_PATTERNS = [
  /^\/dev\/fd\/\d+$/,
  /^\/proc\/\d+\/fd\/\d+$/,
  /^\/proc\/self\/fd\/\d+$/,
  /^\/proc\/self\/environ$/,
];

/** P0-5: 受保护的文件名 (basename 匹配) */
const DANGEROUS_FILES = new Set([
  '.gitconfig', '.gitmodules',
  '.bashrc', '.zshrc', '.profile', '.bash_profile',
  '.env', '.env.local', '.env.production',
]);

/** P0-5: 受保护的路径组件 (路径中任一段匹配) */
const DANGEROUS_PATH_SEGMENTS = new Set([
  '.git', '.vscode', '.idea', '.claude',
  '.ssh', '.aws', '.gnupg',
]);

/** 检测路径是否被阻止读取 */
function isBlockedReadPath(filePath: string): boolean {
  if (BLOCKED_READ_PATHS.has(filePath)) return true;
  return BLOCKED_READ_PATH_PATTERNS.some(p => p.test(filePath));
}

/** 检测路径是否是受保护文件 (edit/write 拒绝) */
function isDangerousWritePath(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (DANGEROUS_FILES.has(basename)) return true;
  const segments = filePath.split(path.sep);
  return segments.some(s => DANGEROUS_PATH_SEGMENTS.has(s));
}

/** grep 最大匹配数 */
const GREP_MAX_MATCHES = 100;

/** find 最大文件数 */
const FIND_MAX_FILES = 1000;

// ═══════════════════════════════════════════════════════════════════════════
// Read Tool
// ═══════════════════════════════════════════════════════════════════════════

function createReadTool(contextWindowTokens: number, fileStateCache: FileStateCache): KernelTool {
  // 自适应读取上限 (参考 adaptive-read.ts)
  const adaptiveMaxBytes = Math.min(
    Math.max(contextWindowTokens * CHARS_PER_TOKEN * CONTEXT_SHARE, 50 * 1024),
    MAX_ADAPTIVE_BYTES,
  );
  const adaptiveMaxLines = Math.floor(adaptiveMaxBytes / 80);

  return {
    name: 'read',
    description: '读取文件内容（文本或图片），大文件用 offset/limit 分段',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件的绝对路径' },
        offset: { type: 'number', description: '起始行号 (1-indexed)' },
        limit: { type: 'number', description: '读取的行数' },
      },
      required: ['file_path'],
    },

    async call(input): Promise<ToolCallResult> {
      const filePath = input.file_path as string;
      const offset = (input.offset as number) ?? 1;
      const limit = (input.limit as number) ?? adaptiveMaxLines;

      if (!filePath) {
        return { content: '错误：缺少 file_path 参数', isError: true };
      }

      // P0-3: 阻止危险设备路径
      if (isBlockedReadPath(filePath)) {
        return { content: `错误：不允许读取此路径 - ${filePath}`, isError: true };
      }

      try {
        // 检查文件是否存在
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          return { content: `错误：${filePath} 是目录，请使用 ls 工具`, isError: true };
        }

        // 图片检测
        const ext = path.extname(filePath).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const data = fs.readFileSync(filePath);
          const base64 = data.toString('base64');
          const mediaType = ext === '.svg' ? 'image/svg+xml'
            : ext === '.png' ? 'image/png'
            : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
            : ext === '.bmp' ? 'image/bmp'
            : ext === '.ico' ? 'image/x-icon'
            : 'image/jpeg';

          // 5MB 限制
          if (data.length > 5 * 1024 * 1024) {
            return { content: `错误：图片文件过大 (${(data.length / 1024 / 1024).toFixed(1)}MB)，最大支持 5MB`, isError: true };
          }

          return { content: `[图片: ${path.basename(filePath)}, ${mediaType}, ${data.length} bytes]\nbase64:${base64}` };
        }

        // 文本文件
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;

        // offset/limit 裁剪 (1-indexed)
        const startIdx = Math.max(0, offset - 1);
        const endIdx = Math.min(totalLines, startIdx + limit);
        const selectedLines = lines.slice(startIdx, endIdx);

        // cat -n 格式 (紧凑模式: 行号 + tab + 内容)
        const formatted = selectedLines.map((line, i) => {
          const lineNum = startIdx + i + 1;
          return `${lineNum}\t${line}`;
        }).join('\n');

        // P0-6: 记录文件读取状态
        const isPartialView = (offset > 1) || (limit < totalLines);
        fileStateCache.recordRead(filePath, content.length, isPartialView);

        // 截断标记
        const truncated = endIdx < totalLines;
        const result = truncated
          ? `${formatted}\n\n[... 文件共 ${totalLines} 行，已显示 ${startIdx + 1}-${endIdx} 行]`
          : formatted;

        return { content: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return { content: `错误：文件不存在 - ${filePath}`, isError: true };
        }
        return { content: `错误：读取文件失败 - ${msg}`, isError: true };
      }
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Write Tool
// ═══════════════════════════════════════════════════════════════════════════

function createWriteTool(fileStateCache: FileStateCache): KernelTool {
  return {
    name: 'write',
    description: '创建或覆盖文件，自动创建父目录',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件的绝对路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['file_path', 'content'],
    },

    async call(input): Promise<ToolCallResult> {
      const filePath = input.file_path as string;
      const content = input.content as string;

      if (!filePath) {
        return { content: '错误：缺少 file_path 参数', isError: true };
      }
      if (content === undefined || content === null) {
        return { content: '错误：缺少 content 参数', isError: true };
      }

      // P0-5: 危险文件保护
      if (isDangerousWritePath(filePath)) {
        return { content: `错误：此文件受保护，不允许修改 - ${filePath}`, isError: true };
      }

      try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });

        const existed = fs.existsSync(filePath);

        // P0-6: 覆盖已存在文件时检查 staleness
        if (existed) {
          const stale = fileStateCache.checkStaleness(filePath);
          if (stale) {
            return { content: `错误：${stale} - ${filePath}`, isError: true };
          }
        }

        fs.writeFileSync(filePath, content, 'utf-8');

        const lineCount = content.split('\n').length;
        return {
          content: existed
            ? `已更新文件 ${filePath} (${lineCount} 行)`
            : `已创建文件 ${filePath} (${lineCount} 行)`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `错误：写入文件失败 - ${msg}`, isError: true };
      }
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Edit Tool — 参考 Claude Code FileEditTool 三步匹配降级
// ═══════════════════════════════════════════════════════════════════════════

/** Unicode 弯引号 → 直引号 规范化 */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')   // " " → "
    .replace(/[\u2018\u2019]/g, "'");  // ' ' → '
}

function createEditTool(fileStateCache: FileStateCache): KernelTool {
  return {
    name: 'edit',
    description: '精确替换文件中的文本片段（oldText → newText）',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件的绝对路径' },
        old_string: { type: 'string', description: '要替换的原始文本' },
        new_string: { type: 'string', description: '替换后的新文本' },
        replace_all: { type: 'boolean', description: '是否替换所有匹配 (默认 false)' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },

    async call(input): Promise<ToolCallResult> {
      const filePath = input.file_path as string;
      const oldString = input.old_string as string;
      const newString = input.new_string as string;
      const replaceAll = (input.replace_all as boolean) ?? false;

      if (!filePath) return { content: '错误：缺少 file_path 参数', isError: true };
      if (oldString === undefined) return { content: '错误：缺少 old_string 参数', isError: true };
      if (newString === undefined) return { content: '错误：缺少 new_string 参数', isError: true };
      if (oldString === newString) return { content: '错误：old_string 和 new_string 相同，无需替换', isError: true };

      // P0-5: 危险文件保护
      if (isDangerousWritePath(filePath)) {
        return { content: `错误：此文件受保护，不允许修改 - ${filePath}`, isError: true };
      }

      try {
        if (!fs.existsSync(filePath)) {
          // 空 old_string + 文件不存在 → 创建新文件
          if (oldString === '') {
            const dir = path.dirname(filePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, newString, 'utf-8');
            return { content: `已创建文件 ${filePath}` };
          }
          return { content: `错误：文件不存在 - ${filePath}`, isError: true };
        }

        // 文件大小检查 (1 GiB)
        const stat = fs.statSync(filePath);
        if (stat.size > 1024 * 1024 * 1024) {
          return { content: '错误：文件过大 (>1 GiB)，无法编辑', isError: true };
        }

        // P0-6: 先读后写校验
        const stale = fileStateCache.checkStaleness(filePath);
        if (stale) {
          return { content: `错误：${stale} - ${filePath}`, isError: true };
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');

        // 空 old_string + 文件存在 → 报错 (应使用 write)
        if (oldString === '') {
          return { content: '错误：文件已存在，old_string 不能为空。如需覆盖请使用 write 工具', isError: true };
        }

        // ─── 三步匹配降级 (参考 Claude Code) ───

        let actualOldString = oldString;
        let matchCount = countOccurrences(fileContent, oldString);

        // Step 1: 精确匹配
        if (matchCount === 0) {
          // Step 2: 引号规范化
          const normalizedFile = normalizeQuotes(fileContent);
          const normalizedSearch = normalizeQuotes(oldString);
          matchCount = countOccurrences(normalizedFile, normalizedSearch);

          if (matchCount > 0) {
            // 从规范化后的文件中提取实际匹配的原始文本
            const idx = normalizedFile.indexOf(normalizedSearch);
            actualOldString = fileContent.slice(idx, idx + normalizedSearch.length);
            matchCount = countOccurrences(fileContent, actualOldString);
          }
        }

        if (matchCount === 0) {
          return { content: `错误：old_string 未在文件中找到。请确认文本精确匹配（包括空格和缩进）`, isError: true };
        }

        if (matchCount > 1 && !replaceAll) {
          return {
            content: `错误：old_string 在文件中出现 ${matchCount} 次。请提供更多上下文使其唯一，或设置 replace_all: true`,
            isError: true,
          };
        }

        // ─── 执行替换 ───
        const newContent = replaceAll
          ? fileContent.replaceAll(actualOldString, newString)
          : fileContent.replace(actualOldString, newString);

        fs.writeFileSync(filePath, newContent, 'utf-8');

        const replacements = replaceAll ? matchCount : 1;
        return {
          content: `已编辑文件 ${filePath} (替换 ${replacements} 处)`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `错误：编辑文件失败 - ${msg}`, isError: true };
      }
    },

    isReadOnly: () => false,
    isConcurrencySafe: () => false,
  };
}

/** 计算子串出现次数 */
function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Grep Tool
// ═══════════════════════════════════════════════════════════════════════════

function createGrepTool(): KernelTool {
  return {
    name: 'grep',
    description: '搜索文件内容，返回匹配行+文件路径+行号',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索的正则表达式模式' },
        path: { type: 'string', description: '搜索目录 (默认当前目录)' },
        include: { type: 'string', description: '文件 glob 过滤 (如 "*.ts")' },
      },
      required: ['pattern'],
    },

    async call(input): Promise<ToolCallResult> {
      const pattern = input.pattern as string;
      const searchPath = (input.path as string) || process.cwd();
      const include = input.include as string | undefined;

      if (!pattern) {
        return { content: '错误：缺少 pattern 参数', isError: true };
      }

      try {
        // 优先使用 ripgrep，回退到 grep
        const hasRg = hasCommand('rg');
        let cmd: string;

        if (hasRg) {
          cmd = `rg -n --max-count ${GREP_MAX_MATCHES} --max-columns 500 --hidden`;
          cmd += ` --glob '!.git'`;
          if (include) cmd += ` --glob '${include}'`;
          cmd += ` -e ${shellEscape(pattern)} ${shellEscape(searchPath)}`;
        } else {
          cmd = `grep -rn --max-count=${GREP_MAX_MATCHES}`;
          if (include) cmd += ` --include='${include}'`;
          cmd += ` -E ${shellEscape(pattern)} ${shellEscape(searchPath)}`;
        }

        const result = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 5 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!result.trim()) {
          return { content: '未找到匹配' };
        }

        // 限制输出行数
        const lines = result.trim().split('\n');
        const limited = lines.slice(0, GREP_MAX_MATCHES);
        const output = limited.join('\n');

        return {
          content: lines.length > GREP_MAX_MATCHES
            ? `${output}\n\n[... 共 ${lines.length} 个匹配，显示前 ${GREP_MAX_MATCHES} 个]`
            : output,
        };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        // grep 退出码 1 = 无匹配（正常）
        if (e.status === 1) {
          return { content: '未找到匹配' };
        }
        const msg = e.stderr || (err instanceof Error ? err.message : String(err));
        return { content: `错误：搜索失败 - ${msg}`, isError: true };
      }
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Find Tool
// ═══════════════════════════════════════════════════════════════════════════

function createFindTool(): KernelTool {
  return {
    name: 'find',
    description: '按 glob 模式搜索文件路径',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式 (如 "**/*.ts", "src/**/test*")' },
        path: { type: 'string', description: '搜索目录 (默认当前目录)' },
      },
      required: ['pattern'],
    },

    async call(input): Promise<ToolCallResult> {
      const pattern = input.pattern as string;
      const searchPath = (input.path as string) || process.cwd();

      if (!pattern) {
        return { content: '错误：缺少 pattern 参数', isError: true };
      }

      try {
        // 使用 find + glob 模式
        const cmd = `find ${shellEscape(searchPath)} -maxdepth 10 -type f -name ${shellEscape(pattern)} 2>/dev/null | head -${FIND_MAX_FILES}`;

        const result = execSync(cmd, {
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 5 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!result.trim()) {
          return { content: '未找到匹配文件' };
        }

        const files = result.trim().split('\n');
        return {
          content: files.length >= FIND_MAX_FILES
            ? `${files.join('\n')}\n\n[... 结果已截断，共显示 ${FIND_MAX_FILES} 个文件]`
            : files.join('\n'),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `错误：搜索失败 - ${msg}`, isError: true };
      }
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Ls Tool
// ═══════════════════════════════════════════════════════════════════════════

function createLsTool(): KernelTool {
  return {
    name: 'ls',
    description: '列出目录内容',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径 (默认当前目录)' },
      },
    },

    async call(input): Promise<ToolCallResult> {
      const dirPath = (input.path as string) || process.cwd();

      try {
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
          return { content: `错误：${dirPath} 不是目录`, isError: true };
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = entries.map(entry => {
          const suffix = entry.isDirectory() ? '/' : '';
          return `${entry.name}${suffix}`;
        });

        if (lines.length === 0) {
          return { content: '(空目录)' };
        }

        return { content: lines.join('\n') };
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') {
          return { content: `错误：目录不存在 - ${dirPath}`, isError: true };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `错误：列出目录失败 - ${msg}`, isError: true };
      }
    },

    isReadOnly: () => true,
    isConcurrencySafe: () => true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** shell 参数转义 */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** 检测命令是否可用 */
function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 构建全部内置工具
 *
 * @param contextWindowTokens - 模型 context window 大小 (用于 adaptive read)
 * @returns KernelTool 数组
 */
export function createBuiltinTools(contextWindowTokens: number): KernelTool[] {
  // 共享文件状态缓存 (read/edit/write 用于先读后写校验)
  const fileStateCache = new FileStateCache();

  return [
    createReadTool(contextWindowTokens, fileStateCache),
    createWriteTool(fileStateCache),
    createEditTool(fileStateCache),
    createGrepTool(),
    createFindTool(),
    createLsTool(),
  ];
}

/** @internal 仅供测试使用 */
export const _testing = {
  createReadTool,
  createWriteTool,
  createEditTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  normalizeQuotes,
  countOccurrences,
  shellEscape,
  isBlockedReadPath,
  isDangerousWritePath,
  FileStateCache,
};
