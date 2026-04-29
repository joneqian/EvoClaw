/**
 * Loop Guard —— Layer 2 多 bot 群协作的回环 / 雪崩防护（M13 关键安全层）
 *
 * 五层熔断（任一触发即拦截 peer fanout）：
 *   1. 单任务 @ 链深度 ≤ MAX_CHAIN_DEPTH(5)         防止无止境的传球
 *   2. 群消息频率 > GROUP_MSG_RATE_LIMIT 条/60s        暂停 60s peer fanout
 *   3. 乒乓熔断：两 agent 互 @ ≥ PING_PONG_THRESHOLD(5) 次而无 task status 变化  冻结
 *   4. 自我保护：Agent 自己 @ 自己（幻觉）            直接丢
 *   5. 最终硬熔断：单群 60s 内超过 HARD_CIRCUIT_LIMIT(100) 条 bot 消息   熔断 300s
 *
 * 每条 peer 消息必须先经 evaluatePeerMessage()，返回 'pass' 才能走后续路由。
 *
 * 若 team_mode.loop_guard_enabled 为 false（feature flag），整体降级为 always-pass，
 * 仍记录日志便于回溯。
 */

import { createLogger } from '../../infrastructure/logger.js';
import type { GroupSessionKey } from '../../channel/team-mode/team-channel.js';

const logger = createLogger('team-mode/loop-guard');

// ─── 常量配置（未来可从 settings 读取）───
export const MAX_CHAIN_DEPTH = 5;
export const GROUP_MSG_RATE_LIMIT = 20;            // 每 60s 内 bot 消息数
export const GROUP_MSG_RATE_WINDOW_MS = 60_000;
export const GROUP_RATE_PAUSE_MS = 60_000;          // 触发后暂停 fanout 时长
export const PING_PONG_THRESHOLD = 5;               // 互 @ 次数阈值
export const PING_PONG_WINDOW_MS = 10 * 60_000;     // 10 min 内累计
export const HARD_CIRCUIT_LIMIT = 100;              // 单群 60s 内 bot 消息数硬熔断阈值
export const HARD_CIRCUIT_PAUSE_MS = 300_000;       // 熔断 300s

export type GuardDecision =
  | { result: 'pass' }
  | { result: 'block'; reason: BlockReason; detail?: string };

export type BlockReason =
  | 'chain_depth_exceeded'      // 链深度超限
  | 'rate_limited'              // 群频率限流
  | 'rate_paused'               // 群处于 pause 状态
  | 'ping_pong_freeze'          // 乒乓熔断
  | 'self_mention'              // 自 @ 自
  | 'hard_circuit'              // 硬熔断
  | 'guard_disabled_passthrough'; // 永远不会出现，保留枚举

/** evaluatePeerMessage 的入参 */
export interface PeerMessageContext {
  groupSessionKey: GroupSessionKey;
  /** 发送方 Agent ID（已识别为同事） */
  fromAgentId: string;
  /** 接收方 Agent ID（即被 @ 的同事） */
  toAgentId: string;
  /** 消息 metadata 中的 task_id（若有） */
  taskId?: string;
  /** 已传递的链深度（adapter 从消息扩展字段抽出） */
  chainDepth?: number;
  /** 时间戳（默认 Date.now()，方便测试注入） */
  now?: number;
}

interface RateRecord {
  /** 时间戳列表（毫秒），保留最近 GROUP_MSG_RATE_WINDOW_MS 内 */
  timestamps: number[];
  /** 软暂停截止时间（速率限流触发时设置） */
  pausedUntil: number;
  /** 硬熔断截止时间 */
  hardCircuitUntil: number;
}

interface PingPongRecord {
  /** 最近 PING_PONG_WINDOW_MS 内 from→to 互 @ 时间戳 */
  timestamps: number[];
  /**
   * 最近一次涉及的 task_id → 最近时间戳，用于"无 status 变化"语义判断
   *
   * N4 修复：从 Set<string> 改为 Map<string, number>，pruneTimestamps 时同步
   * 删除超出 PING_PONG_WINDOW_MS 的旧 task 条目，避免内存无限增长
   */
  taskIds: Map<string, number>;
  /** 冻结直到时间戳 */
  frozenUntil: number;
}

export interface LoopGuardOptions {
  /** Feature flag：team_mode.loop_guard_enabled，false 时全部 pass 但仍记录 */
  enabled?: boolean;
}

export class LoopGuard {
  private rates = new Map<GroupSessionKey, RateRecord>();
  private pingPongs = new Map<string, PingPongRecord>(); // key: groupKey|min(a,b)|max(a,b)
  private enabled: boolean;

  constructor(opts: LoopGuardOptions = {}) {
    this.enabled = opts.enabled !== false; // 默认 true
    logger.info(`loop-guard 初始化 enabled=${this.enabled}`);
  }

  /**
   * 评估一条 peer 消息是否放行
   */
  evaluate(ctx: PeerMessageContext): GuardDecision {
    const now = ctx.now ?? Date.now();

    // 第 4 层：自 @ 自（即使关熔断也要拦，纯粹反幻觉）
    if (ctx.fromAgentId === ctx.toAgentId) {
      logger.warn(
        `自 @ 自拦截 agentId=${ctx.fromAgentId} key=${ctx.groupSessionKey}`,
      );
      return { result: 'block', reason: 'self_mention' };
    }

    if (!this.enabled) {
      // Feature flag 关闭：直接放行，但记录日志便于回溯
      logger.debug(
        `loop-guard 已禁用，pass-through from=${ctx.fromAgentId} to=${ctx.toAgentId} key=${ctx.groupSessionKey}`,
      );
      return { result: 'pass' };
    }

    // 第 5 层（最早判定）：硬熔断（已触发期内）
    const rate = this.getOrCreateRate(ctx.groupSessionKey);
    if (rate.hardCircuitUntil > now) {
      const remaining = Math.ceil((rate.hardCircuitUntil - now) / 1000);
      logger.error(
        `硬熔断中拦截 key=${ctx.groupSessionKey} from=${ctx.fromAgentId} 剩余=${remaining}s`,
      );
      return {
        result: 'block',
        reason: 'hard_circuit',
        detail: `单群 60s 内超过 ${HARD_CIRCUIT_LIMIT} 条 bot 消息，熔断剩余 ${remaining}s`,
      };
    }

    // 第 1 层：链深度
    const depth = ctx.chainDepth ?? 0;
    if (depth >= MAX_CHAIN_DEPTH) {
      logger.warn(
        `链深度超限拦截 from=${ctx.fromAgentId} to=${ctx.toAgentId} task=${ctx.taskId} depth=${depth}`,
      );
      return {
        result: 'block',
        reason: 'chain_depth_exceeded',
        detail: `单任务 @ 链深度 ${depth} ≥ ${MAX_CHAIN_DEPTH}`,
      };
    }

    // 第 2 层：群速率限流（先看是否仍在暂停期）
    if (rate.pausedUntil > now) {
      const remaining = Math.ceil((rate.pausedUntil - now) / 1000);
      logger.warn(
        `群处于速率暂停期 key=${ctx.groupSessionKey} from=${ctx.fromAgentId} 剩余=${remaining}s`,
      );
      return {
        result: 'block',
        reason: 'rate_paused',
        detail: `群限流暂停剩余 ${remaining}s`,
      };
    }

    // 计入本次消息时间戳，再判频率
    rate.timestamps.push(now);
    pruneTimestamps(rate.timestamps, now - GROUP_MSG_RATE_WINDOW_MS);

    // 触发硬熔断（最严重）
    if (rate.timestamps.length > HARD_CIRCUIT_LIMIT) {
      rate.hardCircuitUntil = now + HARD_CIRCUIT_PAUSE_MS;
      logger.error(
        `硬熔断触发 key=${ctx.groupSessionKey} 60s消息数=${rate.timestamps.length} ` +
          `熔断时长=${HARD_CIRCUIT_PAUSE_MS / 1000}s`,
      );
      return {
        result: 'block',
        reason: 'hard_circuit',
        detail: `单群 60s 内 ${rate.timestamps.length} 条 bot 消息，超过硬熔断阈值 ${HARD_CIRCUIT_LIMIT}`,
      };
    }

    // 触发群速率限流
    if (rate.timestamps.length > GROUP_MSG_RATE_LIMIT) {
      rate.pausedUntil = now + GROUP_RATE_PAUSE_MS;
      logger.warn(
        `群速率限流触发 key=${ctx.groupSessionKey} 60s消息数=${rate.timestamps.length} ` +
          `暂停时长=${GROUP_RATE_PAUSE_MS / 1000}s`,
      );
      return {
        result: 'block',
        reason: 'rate_limited',
        detail: `群 60s 内 ${rate.timestamps.length} 条 bot 消息，超过 ${GROUP_MSG_RATE_LIMIT}`,
      };
    }

    // 第 3 层：乒乓熔断
    const pongKey = makePingPongKey(ctx.groupSessionKey, ctx.fromAgentId, ctx.toAgentId);
    const pong = this.getOrCreatePingPong(pongKey);
    if (pong.frozenUntil > now) {
      const remaining = Math.ceil((pong.frozenUntil - now) / 1000);
      logger.warn(
        `乒乓冻结中 ${ctx.fromAgentId}↔${ctx.toAgentId} key=${ctx.groupSessionKey} 剩余=${remaining}s`,
      );
      return {
        result: 'block',
        reason: 'ping_pong_freeze',
        detail: `peer ${ctx.fromAgentId}↔${ctx.toAgentId} 乒乓冻结剩余 ${remaining}s`,
      };
    }

    pong.timestamps.push(now);
    pruneTimestamps(pong.timestamps, now - PING_PONG_WINDOW_MS);
    // N4 修复：taskIds 改 Map<taskId, latestTs>，同步剔除窗口外的旧 task 条目
    if (ctx.taskId) {
      pong.taskIds.set(ctx.taskId, now);
    }
    pruneTaskIds(pong.taskIds, now - PING_PONG_WINDOW_MS);

    if (pong.timestamps.length >= PING_PONG_THRESHOLD) {
      // task 多样化判定：只有 1 个 task 反复互 @ 才算乒乓
      // （多 task 互动是正常协作）
      if (pong.taskIds.size <= 1) {
        pong.frozenUntil = now + PING_PONG_WINDOW_MS;
        logger.error(
          `乒乓熔断触发 ${ctx.fromAgentId}↔${ctx.toAgentId} key=${ctx.groupSessionKey} ` +
            `次数=${pong.timestamps.length} task_id=${ctx.taskId ?? 'none'}`,
        );
        return {
          result: 'block',
          reason: 'ping_pong_freeze',
          detail: `peer ${ctx.fromAgentId}↔${ctx.toAgentId} 同一任务互 @ ${pong.timestamps.length} 次，冻结`,
        };
      }
    }

    return { result: 'pass' };
  }

  /**
   * 通知乒乓熔断器：某 task 状态发生有意义变化
   *
   * 调用时机：update_task_status 工具被调用时
   * 作用：清掉与该 task 关联的乒乓累积，避免"正常合作完一个任务后被误判为乒乓"
   */
  notifyTaskStatusChanged(taskId: string): void {
    let cleared = 0;
    for (const pong of this.pingPongs.values()) {
      if (pong.taskIds.has(taskId)) {
        pong.taskIds.delete(taskId);
        // 同时清掉时间戳，给该 pair 一个 fresh start
        pong.timestamps.length = 0;
        cleared++;
      }
    }
    if (cleared > 0) {
      logger.debug(`task=${taskId} 状态变更，清理 ${cleared} 个乒乓记录`);
    }
  }

  /**
   * 重置（测试 / 紧急回退用）
   */
  reset(): void {
    this.rates.clear();
    this.pingPongs.clear();
  }

  /**
   * 启用 / 禁用熔断（feature flag 切换用）
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      logger.info(`loop-guard 状态切换 ${this.enabled} → ${enabled}`);
      this.enabled = enabled;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // 仅测试 / 内部调试用
  _peekRate(groupKey: GroupSessionKey): RateRecord | undefined {
    return this.rates.get(groupKey);
  }

  _peekPingPong(groupKey: GroupSessionKey, a: string, b: string): PingPongRecord | undefined {
    return this.pingPongs.get(makePingPongKey(groupKey, a, b));
  }

  private getOrCreateRate(key: GroupSessionKey): RateRecord {
    let rec = this.rates.get(key);
    if (!rec) {
      rec = { timestamps: [], pausedUntil: 0, hardCircuitUntil: 0 };
      this.rates.set(key, rec);
    }
    return rec;
  }

  private getOrCreatePingPong(key: string): PingPongRecord {
    let rec = this.pingPongs.get(key);
    if (!rec) {
      rec = { timestamps: [], taskIds: new Map<string, number>(), frozenUntil: 0 };
      this.pingPongs.set(key, rec);
    }
    return rec;
  }
}

/** pair key：群 + 双方 agentId 排序后拼，确保 (A,B) 与 (B,A) 共享一个记录 */
function makePingPongKey(groupKey: GroupSessionKey, a: string, b: string): string {
  const [low, high] = a < b ? [a, b] : [b, a];
  return `${groupKey}|${low}|${high}`;
}

/** 删掉早于 cutoff 的时间戳（in-place） */
function pruneTimestamps(arr: number[], cutoff: number): void {
  let i = 0;
  while (i < arr.length && arr[i] < cutoff) i++;
  if (i > 0) arr.splice(0, i);
}

/**
 * N4 修复：删掉 taskIds Map 中早于 cutoff 的 entry（in-place）
 *
 * 防止长期运行下 taskIds Map 单向增长（每来一个新 taskId 都加，从不清）
 */
function pruneTaskIds(map: Map<string, number>, cutoff: number): void {
  for (const [taskId, ts] of map) {
    if (ts < cutoff) map.delete(taskId);
  }
}
