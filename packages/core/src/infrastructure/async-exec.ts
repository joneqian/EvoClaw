/**
 * 异步命令执行引擎
 *
 * 替代 execSync，基于 spawn 实现非阻塞执行，支持:
 * - 流式 stdout/stderr 收集 (onProgress 回调)
 * - AbortController 外部取消
 * - 超时处理: timeout → SIGTERM → grace period → SIGKILL
 * - 大输出持久化到磁盘 (>30K 字符返回引用)
 * - 输出截断: head 70% + tail 30%
 * - 图片输出检测 (base64 PNG/JPEG/GIF)
 *
 * 参考 Claude Code BashTool runShellCommand 异步生成器架构
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { sanitizeEnv } from '@evoclaw/shared';
import { createLogger } from './logger.js';

const envLog = createLogger('async-exec-env');

// ─── Types ───

export interface AsyncExecOptions {
  /** 工作目录 (默认 process.cwd()) */
  cwd?: string;
  /** 超时毫秒 (默认 120_000) */
  timeoutMs?: number;
  /** SIGTERM 后等待进程退出的宽限期毫秒 (默认 3000) */
  graceMs?: number;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 额外环境变量 */
  env?: Record<string, string>;
  /** 流式进度回调 (每批新输出调用一次) */
  onProgress?: (progress: ProgressEvent) => void;
  /** 最大输出字符数 (默认 200_000) */
  maxOutputChars?: number;
  /** Shell 环境快照脚本 (future: Sprint 6 Shell Snapshot) */
  shellInit?: string;
  /** M8: 额外敏感变量名正则（与默认 SENSITIVE_PATTERNS 取并集） */
  customSensitivePatterns?: readonly RegExp[];
}

export interface ProgressEvent {
  /** 本批新增行 */
  lastLines: string;
  /** 当前已收集的总行数 */
  totalLines: number;
  /** 当前已收集的总字节数 */
  totalBytes: number;
}

export interface ExecResult {
  /** 命令输出 (stdout + stderr 交织) */
  stdout: string;
  /** 单独的 stderr (用于错误分析) */
  stderr: string;
  /** 退出码 (null = 被信号终止) */
  exitCode: number | null;
  /** 是否被超时终止 */
  timedOut: boolean;
  /** 是否被外部信号取消 */
  aborted: boolean;
  /** 检测到的图片数据 (base64) */
  detectedImages?: DetectedImage[];
}

export interface DetectedImage {
  /** MIME 类型 */
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif';
  /** base64 编码数据 */
  base64: string;
}

// ─── Constants ───

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_GRACE_MS = 3_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
/** 大输出持久化到磁盘的阈值 */
const PERSIST_THRESHOLD_CHARS = 30_000;
/** 最大持久化大小 (64MB) */
const MAX_PERSIST_BYTES = 64 * 1024 * 1024;
/** 持久化目录 */
const PERSIST_DIR = join(tmpdir(), '.evoclaw-exec-output');
/** 进度回调节流间隔 (ms) */
const PROGRESS_THROTTLE_MS = 100;

// ─── Main ───

/**
 * 异步执行 shell 命令
 *
 * @example
 * ```ts
 * const result = await asyncExec('ls -la', { timeoutMs: 5000 });
 * console.log(result.stdout);
 * ```
 */
export async function asyncExec(
  command: string,
  options: AsyncExecOptions = {},
): Promise<ExecResult> {
  const {
    cwd = process.cwd(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    graceMs = DEFAULT_GRACE_MS,
    signal,
    env,
    onProgress,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    shellInit,
    customSensitivePatterns,
  } = options;

  // 如果已经取消，直接返回
  if (signal?.aborted) {
    return { stdout: '', stderr: '', exitCode: null, timedOut: false, aborted: true };
  }

  // 构建实际执行的命令 (预留 shell snapshot 注入点)
  const effectiveCommand = shellInit
    ? `${shellInit}\n${command}`
    : command;

  // M8: 敏感凭据不继承到 bash 子进程
  const { env: sanitizedEnv, stripped } = sanitizeEnv(process.env, {
    mode: 'inherit',
    extraEnv: { ...env, EVOCLAW_SHELL: 'async-exec' },
    customSensitivePatterns,
  });
  if (stripped.length > 0) {
    envLog.debug(`剥离敏感 env 变量: ${stripped.join(', ')}`);
  }

  const child = spawn('bash', ['-c', effectiveCommand], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: sanitizedEnv,
    // 不 detach — 需要正常 I/O 通信
  });

  // 输出收集器 (带内存上限保护)
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let totalBytes = 0;
  let totalLines = 0;
  let lastProgressTime = 0;
  // 字节上限 = 字符上限 × 2 (UTF-8 保守估计) — 防止无限内存增长
  const maxBytes = maxOutputChars * 2;
  let capped = false;

  // 进度节流（force=true 用于流结束时强制 emit 最终状态，绕过节流）
  const emitProgress = (lastLines: string, force = false): void => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressTime < PROGRESS_THROTTLE_MS) return;
    lastProgressTime = now;
    onProgress({ lastLines, totalLines, totalBytes });
  };

  // 收集 stdout (超过上限后停止收集，但进程继续运行)
  child.stdout?.on('data', (chunk: Buffer) => {
    if (!capped) {
      stdoutChunks.push(chunk);
    }
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) capped = true;
    const text = chunk.toString();
    totalLines += countNewlines(text);
    emitProgress(text);
  });

  // 收集 stderr
  child.stderr?.on('data', (chunk: Buffer) => {
    if (!capped) {
      stderrChunks.push(chunk);
    }
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) capped = true;
    const text = chunk.toString();
    totalLines += countNewlines(text);
    emitProgress(`[stderr] ${text}`);
  });

  // 结果 Promise
  return new Promise<ExecResult>((resolve) => {
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      signal?.removeEventListener('abort', onAbort);

      // 最终进度强制 emit（绕过节流），确保调用方拿到最终的 totalLines/totalBytes
      emitProgress('', true);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      const detectedImages = detectImages(stdout);

      resolve({ stdout, stderr, exitCode, timedOut, aborted, detectedImages });
    };

    // 超时处理: SIGTERM → grace → SIGKILL
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killGracefully(child, graceMs);
    }, timeoutMs);

    // 外部取消
    const onAbort = (): void => {
      aborted = true;
      killGracefully(child, graceMs);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // 进程退出
    child.on('exit', (code) => settle(code));
    child.on('error', () => settle(-1));
  });
}

// ─── Output Processing ───

/**
 * 截断输出: head 70% + tail 30%
 */
export function truncateOutput(output: string, maxChars: number = DEFAULT_MAX_OUTPUT_CHARS): string {
  if (output.length <= maxChars) return output;
  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.floor(maxChars * 0.3);
  const omitted = output.length - headSize - tailSize;
  return `${output.slice(0, headSize)}\n\n... [省略 ${omitted} 字符] ...\n\n${output.slice(-tailSize)}`;
}

/**
 * 大输出持久化到磁盘
 * @returns 原始输出或持久化引用
 */
export async function maybePersistOutput(output: string): Promise<{ text: string; persisted: boolean }> {
  if (output.length <= PERSIST_THRESHOLD_CHARS) {
    return { text: output, persisted: false };
  }

  // 截断到最大持久化大小
  const bytes = Buffer.byteLength(output, 'utf-8');
  const toPersist = bytes > MAX_PERSIST_BYTES
    ? output.slice(0, MAX_PERSIST_BYTES)
    : output;

  try {
    await mkdir(PERSIST_DIR, { recursive: true });
    const filename = `exec-${Date.now()}-${randomBytes(4).toString('hex')}.txt`;
    const filepath = join(PERSIST_DIR, filename);
    await writeFile(filepath, toPersist, 'utf-8');

    const preview = output.slice(0, 2000);
    return {
      text: `${preview}\n\n... [完整输出已保存到 ${filepath}，共 ${output.length} 字符。使用 read 工具查看。]`,
      persisted: true,
    };
  } catch {
    // 持久化失败，回退到截断
    return { text: truncateOutput(output), persisted: false };
  }
}

// ─── Image Detection ───

/** Base64 图片 magic bytes 前缀 */
const IMAGE_SIGNATURES: Array<{ prefix: string; mimeType: DetectedImage['mimeType'] }> = [
  { prefix: 'iVBORw0KGgo', mimeType: 'image/png' },      // PNG
  { prefix: '/9j/', mimeType: 'image/jpeg' },              // JPEG
  { prefix: 'R0lGOD', mimeType: 'image/gif' },             // GIF
];

/**
 * 检测输出中的 base64 编码图片
 * 匹配连续 100+ 字符的 base64 字符串
 */
function detectImages(output: string): DetectedImage[] | undefined {
  // 只检测可能包含图片的输出 (至少 100 个 base64 字符)
  const base64Pattern = /[A-Za-z0-9+/=]{100,}/g;
  const matches = output.match(base64Pattern);
  if (!matches) return undefined;

  const images: DetectedImage[] = [];
  for (const match of matches) {
    for (const { prefix, mimeType } of IMAGE_SIGNATURES) {
      if (match.startsWith(prefix)) {
        images.push({ mimeType, base64: match });
        break;
      }
    }
  }

  return images.length > 0 ? images : undefined;
}

// ─── Utilities ───

/** 优雅终止进程: SIGTERM → grace period → SIGKILL */
function killGracefully(child: ReturnType<typeof spawn>, graceMs: number): void {
  try {
    child.kill('SIGTERM');
  } catch {
    return; // 进程已退出
  }

  setTimeout(() => {
    try {
      // 检查进程是否仍在运行
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch {
      // 进程已退出，忽略
    }
  }, graceMs);
}

/** 计算字符串中的换行数 */
function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

// ─── Exports for testing ───

export const _testing = {
  detectImages,
  killGracefully,
  countNewlines,
  PERSIST_THRESHOLD_CHARS,
  PERSIST_DIR,
  IMAGE_SIGNATURES,
};
