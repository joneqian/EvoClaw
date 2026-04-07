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
import { which } from '../../infrastructure/runtime.js';


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
    // Read 工具永不持久化 — 持久化后 LLM 会用 Read 读取持久化文件，造成循环引用
    // Read 通过自身 limit 参数控制大小
    maxResultSizeChars: Infinity,
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件的绝对路径' },
        offset: { type: 'number', description: '起始行号 (1-indexed)' },
        limit: { type: 'number', description: '读取的行数' },
      },
      required: ['file_path'],
    },

    // 输入分叉: hooks 看到展开后的路径，call 看到原始输入
    backfillObservableInput(input: Record<string, unknown>): Record<string, unknown> {
      const filePath = input.file_path as string;
      if (filePath?.startsWith('~/')) {
        return { ...input, file_path: path.join(process.env.HOME ?? '', filePath.slice(2)) };
      }
      return input;
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

          // P2-4: 图片大小限制 + 自适应压缩
          const maxImageBytes = 5 * 1024 * 1024;
          if (data.length > maxImageBytes) {
            // 尝试用 sips (macOS) 缩小图片
            try {
              const tmpOut = path.join(require('node:os').tmpdir(), `evoclaw-resize-${Date.now()}.jpg`);
              const targetWidth = Math.min(2000, Math.floor(2000 * (maxImageBytes / data.length)));
              execSync(`sips --resampleWidth ${targetWidth} --setProperty format jpeg ${shellEscape(filePath)} --out ${shellEscape(tmpOut)}`, { timeout: 30_000, stdio: 'pipe' });
              const resizedData = fs.readFileSync(tmpOut);
              fs.unlinkSync(tmpOut);
              if (resizedData.length <= maxImageBytes) {
                return { content: `[图片(压缩): ${path.basename(filePath)}, image/jpeg, ${resizedData.length} bytes]\nbase64:${resizedData.toString('base64')}` };
              }
            } catch {
              // sips 不可用或失败，回退报错
            }
            return { content: `错误：图片文件过大 (${(data.length / 1024 / 1024).toFixed(1)}MB)，最大支持 5MB`, isError: true };
          }

          return { content: `[图片: ${path.basename(filePath)}, ${mediaType}, ${data.length} bytes]\nbase64:${base64}` };
        }

        // P1-5: PDF 检测
        if (ext === '.pdf') {
          const pdfData = fs.readFileSync(filePath);
          // 验证 PDF magic bytes
          if (pdfData.length >= 5 && pdfData.slice(0, 5).toString() === '%PDF-') {
            const pages = input.pages as string | undefined;
            if (pdfData.length > 20 * 1024 * 1024) {
              return { content: `错误：PDF 文件过大 (${(pdfData.length / 1024 / 1024).toFixed(1)}MB)，最大支持 20MB`, isError: true };
            }
            // 小于 3MB: 直接 base64
            if (pdfData.length < 3 * 1024 * 1024) {
              return { content: `[PDF: ${path.basename(filePath)}, ${pdfData.length} bytes${pages ? `, pages=${pages}` : ''}]\nbase64:${pdfData.toString('base64')}` };
            }
            // 大于 3MB: 尝试 pdftoppm 转 JPEG
            try {
              const pageArgs = pages ? `-f ${pages.split('-')[0]} -l ${pages.split('-')[1] ?? pages.split('-')[0]}` : '-l 20';
              const jpegData = execSync(
                `pdftoppm -jpeg -r 100 ${pageArgs} ${shellEscape(filePath)} /tmp/evoclaw-pdf`,
                { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 },
              );
              return { content: `[PDF 转 JPEG: ${path.basename(filePath)}]\nbase64:${Buffer.from(jpegData).toString('base64')}` };
            } catch {
              // pdftoppm 不可用 → 回退 base64
              return { content: `[PDF: ${path.basename(filePath)}, ${pdfData.length} bytes]\nbase64:${pdfData.toString('base64')}` };
            }
          }
        }

        // P1-4: 编码检测 (UTF-16LE BOM)
        const rawBuffer = fs.readFileSync(filePath);
        const encoding = detectEncoding(rawBuffer);
        const content = encoding === 'utf-16le'
          ? rawBuffer.toString('utf16le').replace(/^\uFEFF/, '') // 去掉 BOM
          : rawBuffer.toString('utf-8');
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
          // P2-5: 路径建议
          const suggestion = suggestSimilarFiles(filePath);
          const msg = suggestion
            ? `错误：文件不存在 - ${filePath}\n\n相似文件: ${suggestion}`
            : `错误：文件不存在 - ${filePath}`;
          return { content: msg, isError: true };
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
// P1-4: 编码检测
// ═══════════════════════════════════════════════════════════════════════════

/** 检测文件编码 (UTF-16LE BOM vs UTF-8) */
function detectEncoding(buffer: Buffer): 'utf-8' | 'utf-16le' {
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return 'utf-16le';
  }
  return 'utf-8';
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

/** P1-2: XML 实体反消毒 (参考 Claude Code FileEditTool/utils.ts) */
function desanitizeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * P1-3: 引号风格保留 (参考 Claude Code FileEditTool/utils.ts)
 *
 * 如果 originalContext 使用弯引号，将 newString 中的直引号转为弯引号。
 * 左引号上下文: 空格/行首/([{ 之后
 * 右引号: 其他位置
 * 缩写: 两字母间的 ' → 右单弯引号 (don't)
 */
function applyQuoteStyle(newString: string, originalContext: string): string {
  // 检测原文是否包含弯引号
  const hasCurlyDouble = /[\u201C\u201D]/.test(originalContext);
  const hasCurlySingle = /[\u2018\u2019]/.test(originalContext);

  if (!hasCurlyDouble && !hasCurlySingle) return newString;

  let result = newString;

  if (hasCurlyDouble) {
    // 替换直双引号为弯双引号
    result = result.replace(/"/g, (_, offset) => {
      // 左引号: 字符串开头，或前面是空格/换行/([{
      if (offset === 0 || /[\s\n([\{—–]/.test(result[offset - 1] ?? '')) {
        return '\u201C'; // 左双弯引号
      }
      return '\u201D'; // 右双弯引号
    });
  }

  if (hasCurlySingle) {
    // 替换直单引号为弯单引号
    result = result.replace(/'/g, (_, offset) => {
      // 缩写检测: 前后都是字母 (don't, it's)
      const prev = result[offset - 1] ?? '';
      const next = result[offset + 1] ?? '';
      if (/[a-zA-Z]/.test(prev) && /[a-zA-Z]/.test(next)) {
        return '\u2019'; // 右单弯引号 (缩写)
      }
      // 左引号上下文
      if (offset === 0 || /[\s\n([\{—–]/.test(prev)) {
        return '\u2018'; // 左单弯引号
      }
      return '\u2019'; // 右单弯引号
    });
  }

  return result;
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

    // 自定义验证: Zod schema 之外的业务逻辑
    async validateInput(input: Record<string, unknown>): Promise<{ valid: boolean; error?: string }> {
      if (input.old_string === input.new_string) {
        return { valid: false, error: 'old_string and new_string must be different' };
      }
      return { valid: true };
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

        // Step 3: P1-2 XML 反消毒 (参考 Claude Code desanitization)
        if (matchCount === 0) {
          const desanitized = desanitizeXml(oldString);
          if (desanitized !== oldString) {
            matchCount = countOccurrences(fileContent, desanitized);
            if (matchCount > 0) {
              actualOldString = desanitized;
            }
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
        // P1-3: 引号风格保留
        const effectiveNewString = applyQuoteStyle(newString, actualOldString);
        const newContent = replaceAll
          ? fileContent.replaceAll(actualOldString, effectiveNewString)
          : fileContent.replace(actualOldString, effectiveNewString);

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
  /** VCS 排除目录 (参考 Claude Code GrepTool) */
  const VCS_EXCLUDES = ['.git', '.svn', '.hg', '.bzr', 'node_modules'];

  return {
    name: 'grep',
    description: '搜索文件内容，返回匹配行+文件路径+行号',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '搜索的正则表达式模式' },
        path: { type: 'string', description: '搜索目录 (默认当前目录)' },
        include: { type: 'string', description: '文件 glob 过滤 (如 "*.ts")' },
        output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: '输出模式 (默认 files_with_matches)' },
        head_limit: { type: 'number', description: '限制结果数 (默认 250)' },
        offset: { type: 'number', description: '跳过前 N 个结果' },
      },
      required: ['pattern'],
    },

    async call(input): Promise<ToolCallResult> {
      const pattern = input.pattern as string;
      const searchPath = (input.path as string) || process.cwd();
      const include = input.include as string | undefined;
      const outputMode = (input.output_mode as string) || 'files_with_matches';
      const headLimit = (input.head_limit as number) ?? 250;
      const offset = (input.offset as number) ?? 0;

      if (!pattern) {
        return { content: '错误：缺少 pattern 参数', isError: true };
      }

      try {
        const hasRg = hasCommand('rg');
        let cmd: string;

        if (hasRg) {
          // P1-6: ripgrep + VCS 排除
          const excludes = VCS_EXCLUDES.map(d => `--glob '!${d}'`).join(' ');

          switch (outputMode) {
            case 'content':
              cmd = `rg -n --max-columns 500 --hidden ${excludes}`;
              break;
            case 'count':
              cmd = `rg -c --hidden ${excludes}`;
              break;
            case 'files_with_matches':
            default:
              cmd = `rg -l --hidden ${excludes}`;
              break;
          }
          if (include) cmd += ` --glob '${include}'`;
          // 以 - 开头的 pattern 用 -e 避免被当作 flag
          cmd += pattern.startsWith('-')
            ? ` -e ${shellEscape(pattern)}`
            : ` ${shellEscape(pattern)}`;
          cmd += ` ${shellEscape(searchPath)}`;
        } else {
          // 回退 grep
          switch (outputMode) {
            case 'content':
              cmd = `grep -rn`;
              break;
            case 'count':
              cmd = `grep -rc`;
              break;
            case 'files_with_matches':
            default:
              cmd = `grep -rl`;
              break;
          }
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

        // P1-6: 分页 (offset + head_limit)
        const allLines = result.trim().split('\n');
        const afterOffset = allLines.slice(offset);
        const limited = headLimit > 0 ? afterOffset.slice(0, headLimit) : afterOffset;
        const output = limited.join('\n');
        const truncated = afterOffset.length > limited.length;

        return {
          content: truncated
            ? `${output}\n\n[... 共 ${allLines.length} 个结果，显示 ${offset + 1}-${offset + limited.length}]`
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
        pattern: { type: 'string', description: '文件名 glob 模式 (如 "*.ts", "test*")' },
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
        // P1-7: 原生 fs 递归 + 简单 glob 匹配 (替代 shell find)
        const files = findFilesRecursive(searchPath, pattern, FIND_MAX_FILES, 10);

        if (files.length === 0) {
          return { content: '未找到匹配文件' };
        }

        // 按 mtime 排序 (最新优先，参考 Claude Code GlobTool)
        files.sort((a: string, b: string) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
          } catch { return 0; }
        });

        const truncated = files.length >= FIND_MAX_FILES;
        const output = files.join('\n');
        return {
          content: truncated
            ? `${output}\n\n[... 结果已截断，共显示 ${FIND_MAX_FILES} 个文件]`
            : output,
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

/**
 * P1-7: 递归搜索文件 (原生 fs，替代 shell find)
 * 简单 glob 匹配: * 匹配任意字符，? 匹配单个字符
 */
function findFilesRecursive(
  dir: string,
  pattern: string,
  maxFiles: number,
  maxDepth: number,
  depth = 0,
  results: string[] = [],
): string[] {
  if (depth > maxDepth || results.length >= maxFiles) return results;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // 跳过隐藏目录和 node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        findFilesRecursive(fullPath, pattern, maxFiles, maxDepth, depth + 1, results);
      } else if (entry.isFile()) {
        if (simpleGlobMatch(entry.name, pattern)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // 权限不足等错误，跳过
  }

  return results;
}

/** 简单 glob 匹配: * 匹配任意字符序列，? 匹配单个字符 */
function simpleGlobMatch(filename: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
    .replace(/\*/g, '.*')                   // * → .*
    .replace(/\?/g, '.');                   // ? → .
  return new RegExp(`^${regex}$`, 'i').test(filename);
}

/**
 * P2-5: 文件不存在时搜索同目录相似文件名
 * 参考 Claude Code: findSimilarFile() + suggestPathUnderCwd()
 */
function suggestSimilarFiles(filePath: string): string | null {
  try {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath).toLowerCase();
    const entries = fs.readdirSync(dir);

    // 找相似文件名 (包含子串 或 编辑距离小)
    const similar = entries
      .filter(e => {
        const lower = e.toLowerCase();
        // 子串匹配
        if (lower.includes(basename) || basename.includes(lower)) return true;
        // 扩展名相同
        if (path.extname(e).toLowerCase() === path.extname(filePath).toLowerCase()) return true;
        return false;
      })
      .slice(0, 5);

    if (similar.length === 0) return null;
    return similar.map(f => path.join(dir, f)).join(', ');
  } catch {
    return null;
  }
}

/** shell 参数转义 */
function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** 检测命令是否可用（Bun: Bun.which() 零进程开销，Node: execSync 回退，结果缓存） */
function hasCommand(cmd: string): boolean {
  return which(cmd) !== null;
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
/** 内置工具 searchHint 映射 */
const BUILTIN_SEARCH_HINTS: Record<string, string> = {
  read: 'read files images PDFs text content',
  write: 'write create files save output',
  edit: 'edit replace modify text string',
  grep: 'search content regex pattern match',
  find: 'find files glob pattern path',
  ls: 'list directory contents files',
};

export function createBuiltinTools(
  contextWindowTokens: number,
  externalFileStateCache?: FileStateCache,
): KernelTool[] {
  // 使用外部缓存（子代理 clone 的）或创建新缓存
  const fileStateCache = externalFileStateCache ?? new FileStateCache();

  const tools = [
    createReadTool(contextWindowTokens, fileStateCache),
    createWriteTool(fileStateCache),
    createEditTool(fileStateCache),
    createGrepTool(),
    createFindTool(),
    createLsTool(),
  ];

  // 注入 searchHint（内置工具不延迟加载）
  return tools.map(tool => ({
    ...tool,
    searchHint: BUILTIN_SEARCH_HINTS[tool.name],
  }));
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
  desanitizeXml,
  applyQuoteStyle,
  simpleGlobMatch,
  detectEncoding,
};
