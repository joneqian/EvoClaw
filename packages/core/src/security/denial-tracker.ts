/**
 * 拒绝追踪器 — 防止工具无限循环
 *
 * 跟踪 per-session 连续拒绝次数:
 * - 连续拒绝超限 → default 模式: 告知用户并停止
 * - 连续拒绝超限 → strict 模式: 抛 AbortError 终止会话
 * - 任何成功工具调用重置计数器
 *
 * 参考 Claude Code denialTracking.ts
 */

import type { PermissionMode } from '@evoclaw/shared';

export interface DenialLimitReached {
  /** 是否达到拒绝上限 */
  limitReached: boolean;
  /** 连续拒绝次数 */
  count: number;
  /** 上限值 */
  limit: number;
  /** 建议动作 */
  action: 'stop' | 'abort' | 'continue';
}

/** 不同模式的拒绝上限 */
const DENIAL_LIMITS: Record<PermissionMode, number> = {
  default: 5,
  strict: 3,
  permissive: 8,
  smart: 6, // 比 default 略宽，因为 smart 模式 LLM 已过滤明显危险
};

export class DenialTracker {
  private consecutiveDenials = 0;
  private mode: PermissionMode = 'default';

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** 记录一次拒绝 */
  recordDenial(): DenialLimitReached {
    this.consecutiveDenials++;
    const limit = DENIAL_LIMITS[this.mode];

    if (this.consecutiveDenials >= limit) {
      return {
        limitReached: true,
        count: this.consecutiveDenials,
        limit,
        action: this.mode === 'strict' ? 'abort' : 'stop',
      };
    }

    return {
      limitReached: false,
      count: this.consecutiveDenials,
      limit,
      action: 'continue',
    };
  }

  /** 记录一次成功工具调用 — 重置计数器 */
  recordSuccess(): void {
    this.consecutiveDenials = 0;
  }

  /** 获取当前连续拒绝次数 */
  getCount(): number {
    return this.consecutiveDenials;
  }

  /** 重置 */
  reset(): void {
    this.consecutiveDenials = 0;
  }
}
