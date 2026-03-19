import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_DIR = path.join(os.homedir(), DEFAULT_DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'core.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB，超过后轮转
const MAX_BACKUPS = 5; // 保留 5 个备份文件
const ROTATE_CHECK_INTERVAL = 60_000; // 每 60 秒检查一次是否需要轮转

let logStream: fs.WriteStream | null = null;
const isDev = !process.env.TAURI_ENV && process.env.NODE_ENV !== 'production';
let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (isDev ? 'debug' : 'info');

// ─── 错误限流：相同错误消息在 N 秒内只记录一次 ───
const ERROR_THROTTLE_MS = 5_000; // 5 秒内相同错误只记一次
const recentErrors = new Map<string, { count: number; firstTime: number; lastTime: number }>();
const ERROR_CLEANUP_INTERVAL = 30_000; // 30 秒清理过期记录

// 定期清理过期的错误限流记录
const errorCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of recentErrors) {
    if (now - entry.lastTime > ERROR_THROTTLE_MS * 2) {
      recentErrors.delete(key);
    }
  }
}, ERROR_CLEANUP_INTERVAL);
errorCleanupTimer.unref(); // 不阻止进程退出

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** 日志文件超过 MAX_LOG_SIZE 时轮转，保留 MAX_BACKUPS 个备份 */
function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= MAX_LOG_SIZE) return;

    // 关闭当前流
    if (logStream) {
      logStream.end();
      logStream = null;
    }

    // 轮转: core.log.4 → 删除, core.log.3 → .4, ... core.log → .1
    for (let i = MAX_BACKUPS; i >= 1; i--) {
      const src = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
      const dst = `${LOG_FILE}.${i}`;
      if (fs.existsSync(src)) {
        if (i === MAX_BACKUPS) {
          fs.unlinkSync(src); // 最老的备份直接删除
        } else {
          if (fs.existsSync(dst)) fs.unlinkSync(dst);
          fs.renameSync(src, dst);
        }
      }
    }
  } catch {
    // 轮转失败不影响运行
  }
}

// 运行时定期检查轮转
let lastRotateCheck = Date.now();

function maybeRotate(): void {
  const now = Date.now();
  if (now - lastRotateCheck < ROTATE_CHECK_INTERVAL) return;
  lastRotateCheck = now;
  rotateIfNeeded();
}

function getStream(): fs.WriteStream {
  if (!logStream || logStream.destroyed) {
    ensureLogDir();
    rotateIfNeeded();
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    // 监听 error 事件防止 EPIPE 等错误导致 uncaughtException
    logStream.on('error', () => {
      // 静默处理写入错误，下次 getStream() 会重建
      logStream = null;
    });
  }
  return logStream;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function serializeExtra(extra: unknown): string {
  if (typeof extra === 'string') return extra;
  if (extra instanceof Error) {
    return JSON.stringify({ message: extra.message, stack: extra.stack, name: extra.name });
  }
  try {
    return JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}

/** 生成错误限流 key（取前 200 字符避免内存膨胀） */
function throttleKey(tag: string, message: string): string {
  return `${tag}:${message.slice(0, 200)}`;
}

function write(level: LogLevel, tag: string, message: string, extra?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  // 错误限流：相同 error/warn 在 ERROR_THROTTLE_MS 内只记录一次
  if (level === 'error' || level === 'warn') {
    const key = throttleKey(tag, message);
    const now = Date.now();
    const entry = recentErrors.get(key);
    if (entry && now - entry.firstTime < ERROR_THROTTLE_MS) {
      entry.count++;
      entry.lastTime = now;
      return; // 限流期内，跳过
    }
    // 如果之前被限流过，补记一条汇总
    if (entry && entry.count > 0) {
      const suppressed = entry.count;
      recentErrors.delete(key);
      const summaryLine = `${formatTimestamp()} [${level.toUpperCase().padEnd(5)}] [${tag}] (以上消息被限流 ${suppressed} 次)`;
      try { getStream().write(summaryLine + '\n'); } catch { /* ignore */ }
      process.stderr.write(summaryLine + '\n');
    }
    recentErrors.set(key, { count: 0, firstTime: now, lastTime: now });
  }

  const ts = formatTimestamp();
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${tag}]`;
  const line = extra !== undefined
    ? `${prefix} ${message} ${serializeExtra(extra)}`
    : `${prefix} ${message}`;

  // 运行时轮转检查
  maybeRotate();

  // 写到文件
  try {
    getStream().write(line + '\n');
  } catch {
    // 文件写入失败不阻塞主逻辑
  }

  // 控制台输出统一走 stderr，避免污染 stdout
  // （Tauri sidecar.rs 通过 stdout 首行 JSON 获取 port/token，stdout 不能有其他输出）
  process.stderr.write(line + '\n');
}

/** 创建带 tag 的 logger 实例 */
export function createLogger(tag: string) {
  return {
    debug: (msg: string, extra?: unknown) => write('debug', tag, msg, extra),
    info: (msg: string, extra?: unknown) => write('info', tag, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', tag, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', tag, msg, extra),
  };
}

/** 设置全局日志级别 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** 关闭日志流（进程退出前调用） */
export function closeLogger(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  clearInterval(errorCleanupTimer);
}

/** 日志文件路径，供外部查询 */
export const LOG_PATH = LOG_FILE;
