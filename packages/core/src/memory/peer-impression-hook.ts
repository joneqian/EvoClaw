/**
 * M13 #3: 同事印象记忆 turn-end hook
 *
 * 主 turn 结束后异步调用：
 *   void triggerPeerImpressionExtraction({...}).catch(() => {});
 *
 * 责任：
 * 1. 守卫 sessionKey marker（cron/subagent/heartbeat/boot 跳过）
 * 2. 守卫 chatType（仅群聊；非群聊跳过）
 * 3. 守卫 peer 检测（无 fromPeerAgentId 跳过；后续可扩展为扫描 LLM 出站 @）
 * 4. 限速：(owner, peer) 对 10 分钟窗口内不重复提取（基于 memory_units.updated_at）
 * 5. 闭包防重入：进程内 Map<owner:peer, Promise> 加锁
 *
 * 永不抛异常；所有失败转 warn log。不阻塞调用方主 turn。
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { MemoryStore } from './memory-store.js';
import {
  extractAndPersistPeerImpression,
  type LLMCallFn,
  type PeerImpressionMessage,
} from './peer-impression-extractor.js';

const log = createLogger('peer-impression-hook');

/** 限速窗口（毫秒），同一 (owner, peer) 对 10 分钟内不重复 */
const DEFAULT_RATE_LIMIT_MS = 10 * 60 * 1000;

/** 进程内并发锁（同一 owner:peer 同时只跑一个 extractor） */
const inFlight = new Map<string, Promise<unknown>>();

/** 主 turn 检查 marker（与 P1-B inline-review-hook 对齐） */
const NON_MAIN_TURN_MARKERS = [':cron:', ':subagent:', ':heartbeat:', ':boot'];

export interface PeerImpressionHookInput {
  /** 当前 owner agent id（system prompt 视角） */
  ownerAgentId: string;
  /** owner agent 名称（注入 prompt 用） */
  ownerAgentName?: string;
  /** 入站 peer agent id；若为空则跳过（本期不扫描出站 mention） */
  fromPeerAgentId?: string;
  /** 入站 peer agent 名称（注入 prompt 用） */
  fromPeerAgentName?: string;
  /** 群聊 / 单聊 */
  chatType: 'private' | 'group';
  /** 当前 sessionKey */
  sessionKey: string;
  /** group session key（用于 lastSeenInGroup 追溯） */
  groupSessionKey?: string;
  /** 最近若干条消息（建议 20-40 条） */
  recentMessages: PeerImpressionMessage[];
  /** SQLite 存储 */
  db: SqliteStore;
  /** 辅助 LLM（与 P1-B inline-review 同 provider） */
  llmCall: LLMCallFn;
  /** 限速窗口（ms），默认 10 分钟 */
  rateLimitMs?: number;
}

export interface PeerImpressionHookResult {
  triggered: boolean;
  reason: string;
  memoryId?: string;
  merged?: boolean;
}

/**
 * Turn 结束 hook：检测 → 限速 → 触发 extractor（fire-and-forget 安全）
 * 返回值仅供测试观察；调用方可忽略 Promise。
 */
export async function triggerPeerImpressionExtraction(
  input: PeerImpressionHookInput,
): Promise<PeerImpressionHookResult> {
  try {
    return await triggerInternal(input);
  } catch (err) {
    log.warn(`[hook][unexpected] err=${err instanceof Error ? err.message : String(err)}`);
    return { triggered: false, reason: 'unexpected-error' };
  }
}

async function triggerInternal(
  input: PeerImpressionHookInput,
): Promise<PeerImpressionHookResult> {
  // [guard 1] sessionKey marker — 非主 turn 跳过
  if (NON_MAIN_TURN_MARKERS.some(m => input.sessionKey.includes(m))) {
    log.debug(`[skip] reason=non-main-turn sessionKey=${input.sessionKey}`);
    return { triggered: false, reason: 'non-main-turn' };
  }

  // [guard 2] 仅群聊 — 单聊不构成 peer 协作
  if (input.chatType !== 'group') {
    log.debug(`[skip] reason=not-group chatType=${input.chatType}`);
    return { triggered: false, reason: 'not-group' };
  }

  // [guard 3] 必须有可识别 peer
  const peerAgentId = input.fromPeerAgentId;
  if (!peerAgentId) {
    log.debug(`[skip] reason=no-peer owner=${input.ownerAgentId}`);
    return { triggered: false, reason: 'no-peer' };
  }
  if (peerAgentId === input.ownerAgentId) {
    log.debug(`[skip] reason=self-reference owner=${input.ownerAgentId}`);
    return { triggered: false, reason: 'self-reference' };
  }

  // [guard 4] 限速 — 检查 memory_units 上次更新时间
  const rateLimitMs = input.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
  const ms = new MemoryStore(input.db);
  const existing = ms.findByMergeKey(input.ownerAgentId, `peer:${peerAgentId}`);
  if (existing) {
    const sinceMs = Date.now() - new Date(existing.updatedAt).getTime();
    if (sinceMs >= 0 && sinceMs < rateLimitMs) {
      log.debug(
        `[skip] reason=rate-limited owner=${input.ownerAgentId} peer=${peerAgentId} ` +
          `sinceMs=${sinceMs} windowMs=${rateLimitMs}`,
      );
      return { triggered: false, reason: 'rate-limited' };
    }
  }

  // [guard 5] 闭包防重入
  const lockKey = `${input.ownerAgentId}:${peerAgentId}`;
  const existingFlight = inFlight.get(lockKey);
  if (existingFlight) {
    log.debug(`[skip] reason=in-progress lockKey=${lockKey}`);
    return { triggered: false, reason: 'in-progress' };
  }

  // 进入临界区：注册 lock，定义异步任务，finally 释放
  const flight = (async (): Promise<PeerImpressionHookResult> => {
    log.info(
      `[hook][trigger] owner=${input.ownerAgentId} peer=${peerAgentId} ` +
        `msgCount=${input.recentMessages.length}`,
    );
    const r = await extractAndPersistPeerImpression({
      ownerAgentId: input.ownerAgentId,
      ownerAgentName: input.ownerAgentName,
      peerAgentId,
      peerAgentName: input.fromPeerAgentName,
      recentMessages: input.recentMessages,
      groupSessionKey: input.groupSessionKey,
      db: input.db,
      llmCall: input.llmCall,
    });
    if (r.skipped) {
      return {
        triggered: false,
        reason: r.reason ?? 'extractor-skipped',
        ...(r.memoryId ? { memoryId: r.memoryId } : {}),
      };
    }
    return {
      triggered: true,
      reason: r.merged ? 'merged' : 'inserted',
      ...(r.memoryId ? { memoryId: r.memoryId } : {}),
      merged: r.merged,
    };
  })();

  inFlight.set(lockKey, flight);
  try {
    return await flight;
  } finally {
    inFlight.delete(lockKey);
  }
}

/** 仅供测试：清空 in-flight 锁（用于 mock 控制） */
export function _clearInFlightLocks(): void {
  inFlight.clear();
}
