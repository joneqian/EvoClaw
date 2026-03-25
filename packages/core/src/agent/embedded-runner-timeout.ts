/**
 * Compaction 感知超时 — 参考 OpenClaw compaction-safety-timeout.ts
 *
 * 普通超时在 compaction 进行中时可能导致 session 状态不一致。
 * Smart timeout 在检测到 compaction 时自动延长 grace period，
 * 等待 compaction 完成后再触发 abort，保证 session 完整性。
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-timeout');

/** Compaction grace period（OpenClaw 用 15 分钟，EvoClaw 桌面场景用 5 分钟） */
const COMPACTION_GRACE_MS = 300_000;

/** Smart timeout 返回值 */
export interface SmartTimeoutHandle {
  /** 清理定时器（在 finally 中调用） */
  clear: () => void;
  /** 是否因超时触发了 abort */
  readonly timedOut: boolean;
  /** 超时是否发生在 compaction 期间 */
  readonly timedOutDuringCompaction: boolean;
}

/**
 * 创建 compaction 感知的智能超时
 *
 * @param timeoutMs - 主超时时间
 * @param isCompacting - 检查 PI session 是否正在 compaction
 * @param onTimeout - 超时回调（通常触发 AbortController.abort()）
 */
export function createSmartTimeout(params: {
  timeoutMs: number;
  isCompacting: () => boolean;
  onTimeout: () => void;
}): SmartTimeoutHandle {
  let graceUsed = false;
  let _timedOut = false;
  let _timedOutDuringCompaction = false;
  let currentTimer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delayMs: number, reason: 'initial' | 'compaction-grace') => {
    currentTimer = setTimeout(() => {
      const compacting = params.isCompacting();

      // Compaction 进行中 → 延长一次 grace period
      if (compacting && !graceUsed) {
        graceUsed = true;
        log.info(`超时但 compaction 进行中，延长 ${COMPACTION_GRACE_MS / 1000}s grace period`);
        schedule(COMPACTION_GRACE_MS, 'compaction-grace');
        return;
      }

      // 标记超时状态
      _timedOut = true;
      if (compacting) {
        _timedOutDuringCompaction = true;
        log.warn('compaction grace period 耗尽，强制超时');
      } else {
        log.info(`PI 超时 (${reason === 'initial' ? params.timeoutMs / 1000 : COMPACTION_GRACE_MS / 1000}s)`);
      }

      params.onTimeout();
    }, Math.max(1, delayMs));
  };

  schedule(params.timeoutMs, 'initial');

  return {
    clear: () => {
      if (currentTimer) clearTimeout(currentTimer);
    },
    get timedOut() { return _timedOut; },
    get timedOutDuringCompaction() { return _timedOutDuringCompaction; },
  };
}

/**
 * 将 promise 包装为可中止的（参考 OpenClaw attempt.ts 的 abortable()）
 *
 * PI 的 session.prompt() 不原生支持 AbortSignal，
 * 此包装在 signal abort 时立即 reject，中止等待。
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}
