import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_DIR = path.join(os.homedir(), '.evoclaw', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'core.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB，超过后轮转

let logStream: fs.WriteStream | null = null;
const isDev = !process.env.TAURI_ENV && process.env.NODE_ENV !== 'production';
let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (isDev ? 'debug' : 'info');

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getStream(): fs.WriteStream {
  if (!logStream) {
    ensureLogDir();
    rotateIfNeeded();
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  }
  return logStream;
}

/** 日志文件超过 MAX_LOG_SIZE 时轮转为 core.log.1 */
function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        const rotated = LOG_FILE + '.1';
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(LOG_FILE, rotated);
      }
    }
  } catch {
    // 轮转失败不影响运行
  }
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function write(level: LogLevel, tag: string, message: string, extra?: unknown): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[currentLevel]) return;

  const ts = formatTimestamp();
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}] [${tag}]`;
  const line = extra !== undefined
    ? `${prefix} ${message} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`
    : `${prefix} ${message}`;

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
}

/** 日志文件路径，供外部查询 */
export const LOG_PATH = LOG_FILE;
