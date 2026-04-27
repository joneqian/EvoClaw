/**
 * Wallclock 兜底超时 — 参考 OpenClaw compaction-safety-timeout.ts
 *
 * 角色定位（M13 重构）：
 *   - 这是 **runner 总时长兜底**（默认 30 分钟），仅防真死循环
 *   - 主超时由 `kernel/idle-watchdog.ts` 的 IdleWatchdog 负责（120s idle）
 *   - 普通工程任务（codegen 多文件、长 bash 链）远到不了 30 分钟，撞上说明大概率失控
 *
 * Compaction 感知：
 *   - compaction 进行中时给一次 grace period（15 分钟，OpenClaw 同款）
 *   - grace 期间仍超时 → 强制 abort，避免无限延后
 *
 * 软警告（M13 新增）：
 *   - 撞 warningRatio × timeoutMs（默认 75%）时触发 onWarning，让 LLM 自主收尾
 *   - 一次性，警告后到真超时之间不再重复
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-timeout');

/**
 * Runner wallclock 兜底（默认 30 分钟）
 *
 * 注（M13 重构）：原 600s 改为 1800s——这是兜底，主超时是 IdleWatchdog 的 120s。
 * 正常工程任务（codegen 30 文件、多回合多工具）远达不到 30 分钟。
 */
export const RUNNER_WALLCLOCK_MS = 1_800_000;

/** Wallclock 警告阈值（撞 75% 时通知 LLM 主动收尾） */
export const RUNNER_WALLCLOCK_WARNING_RATIO = 0.75;

/** Compaction grace period（OpenClaw 同款 15 分钟——compaction 单次确实可能要 1-15 分钟） */
const COMPACTION_GRACE_MS = 900_000;

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
 * 创建 compaction 感知的智能 wallclock 超时
 *
 * @param timeoutMs - 主超时时间（默认建议 RUNNER_WALLCLOCK_MS）
 * @param warningRatio - 警告阈值比例（0~1，默认 0.75）
 * @param isCompacting - 检查 runner 是否正在 compaction
 * @param onWarning - 警告回调（一次性，撞 warningRatio × timeoutMs 时触发）
 * @param onTimeout - 超时回调（通常触发 AbortController.abort()）
 */
export function createSmartTimeout(params: {
  timeoutMs: number;
  warningRatio?: number;
  isCompacting: () => boolean;
  onWarning?: (elapsedMs: number, totalMs: number) => void;
  onTimeout: () => void;
}): SmartTimeoutHandle {
  let graceUsed = false;
  let warningFired = false;
  let _timedOut = false;
  let _timedOutDuringCompaction = false;
  let currentTimer: ReturnType<typeof setTimeout> | undefined;
  let warningTimer: ReturnType<typeof setTimeout> | undefined;

  const ratio = params.warningRatio ?? RUNNER_WALLCLOCK_WARNING_RATIO;
  const warningMs = Math.floor(params.timeoutMs * ratio);

  // 软警告 timer — 一次性
  if (params.onWarning && warningMs > 0 && warningMs < params.timeoutMs) {
    warningTimer = setTimeout(() => {
      warningTimer = undefined;
      if (warningFired || _timedOut) return;
      warningFired = true;
      log.info(`wallclock warning fired (${warningMs / 1000}s, ${Math.floor(ratio * 100)}%)`);
      try {
        params.onWarning?.(warningMs, params.timeoutMs);
      } catch (err) {
        log.warn('wallclock onWarning 抛错（已忽略）', err);
      }
    }, warningMs);
  }

  const schedule = (delayMs: number, reason: 'initial' | 'compaction-grace') => {
    currentTimer = setTimeout(() => {
      const compacting = params.isCompacting();

      // Compaction 进行中 → 延长一次 grace period
      if (compacting && !graceUsed) {
        graceUsed = true;
        log.info(`wallclock 超时但 compaction 进行中，延长 ${COMPACTION_GRACE_MS / 1000}s grace period`);
        schedule(COMPACTION_GRACE_MS, 'compaction-grace');
        return;
      }

      // 标记超时状态
      _timedOut = true;
      if (compacting) {
        _timedOutDuringCompaction = true;
        log.warn('compaction grace period 耗尽，强制超时');
      } else {
        log.info(`runner wallclock 超时 (${reason === 'initial' ? params.timeoutMs / 1000 : COMPACTION_GRACE_MS / 1000}s)`);
      }

      params.onTimeout();
    }, Math.max(1, delayMs));
  };

  schedule(params.timeoutMs, 'initial');

  return {
    clear: () => {
      if (currentTimer) clearTimeout(currentTimer);
      if (warningTimer) clearTimeout(warningTimer);
    },
    get timedOut() { return _timedOut; },
    get timedOutDuringCompaction() { return _timedOutDuringCompaction; },
  };
}

/**
 * 将 promise 包装为可中止的（参考 OpenClaw attempt.ts 的 abortable()）
 *
 * 自研 query-loop 内部 fetch 已经接 AbortSignal，但
 * 上层包装的 promise 不会因 signal 自动 reject —— 这里在 signal abort 时立即 reject，
 * 让等待方提早返回，无需等 fetch 真的抛出。
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
