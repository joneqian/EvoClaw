/**
 * 外层重试循环 — 参考 OpenClaw run.ts 的状态机设计
 *
 * 核心能力：
 * - 20 次迭代状态机
 * - Provider Failover（跨 provider 降级，带冷却期）
 * - Overload 退避 → 3 次后切 provider
 * - Billing/Auth → 立即切 provider（携带消息快照）
 * - Thinking → reasoning 降级
 * - Context overflow → 消息裁剪 + tool result 截断
 * - 全部失败 → 结构化错误
 */

import type { AgentRunConfig, ProviderConfig, MessageSnapshot, RuntimeEvent } from './types.js';
import { type ThinkLevel, degradeThinkLevel } from '@evoclaw/shared';
import { runSingleAttempt } from './embedded-runner-attempt.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner-loop');

type EventCallback = (event: RuntimeEvent) => void;

function emit(cb: EventCallback, event: Omit<RuntimeEvent, 'timestamp'>): void {
  cb({ ...event, timestamp: Date.now() } as RuntimeEvent);
}

/** 最大重试迭代次数上限 */
const MAX_LOOP_ITERATIONS_CAP = 30;

/** 根据 provider 链长度计算动态重试上限 */
function calculateMaxIterations(providerCount: number): number {
  return Math.min(5 + providerCount * 5, MAX_LOOP_ITERATIONS_CAP);
}

/** Provider 冷却期（60 秒内不回切到刚失败的 provider） */
const PROVIDER_COOLDOWN_MS = 60_000;

/** 单 provider overload 最大重试次数（超过后切 provider） */
const MAX_OVERLOAD_BEFORE_FAILOVER = 3;

/** Context overflow 最大 compaction 尝试次数 */
const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;

/** 计算指数退避延迟（含 jitter） */
function calculateBackoff(attempt: number, opts?: {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
}): number {
  const { initialDelayMs = 250, maxDelayMs = 5000, factor = 2, jitter = 0.2 } = opts ?? {};
  const base = Math.min(initialDelayMs * Math.pow(factor, attempt), maxDelayMs);
  const jitterRange = base * jitter;
  return base + (Math.random() * 2 - 1) * jitterRange;
}

/** sleep 辅助 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 截断消息中过大的工具结果（事后补救，参考 OpenClaw） */
function truncateOversizedToolResults(messages: MessageSnapshot[], maxChars: number): MessageSnapshot[] {
  return messages.map(msg => {
    if (msg.content.length <= maxChars) return msg;
    const head = msg.content.slice(0, Math.floor(maxChars * 0.7));
    const tail = msg.content.slice(-Math.floor(maxChars * 0.3));
    return {
      ...msg,
      content: `${head}\n\n... [截断 ${msg.content.length - maxChars} 字符] ...\n\n${tail}`,
    };
  });
}

/**
 * 构建 Provider Failover 链路
 *
 * 优先级：Agent 配置的主 provider → fallbackProviders（按注册顺序）
 */
function buildProviderChain(config: AgentRunConfig): ProviderConfig[] {
  const chain: ProviderConfig[] = [];

  // 1. 主 provider（从 config 的顶层字段构建）
  chain.push({
    provider: config.provider,
    modelId: config.modelId,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    apiProtocol: config.apiProtocol,
  });

  // 2. Fallback providers（去重）
  for (const fb of config.fallbackProviders ?? []) {
    if (!chain.some(c => c.provider === fb.provider && c.modelId === fb.modelId)) {
      chain.push(fb);
    }
  }

  return chain;
}

/**
 * 外层重试循环
 *
 * @param config - Agent 运行配置
 * @param message - 用户消息
 * @param onEvent - 事件回调
 * @param abortSignal - 外部中止信号
 */
export async function runEmbeddedLoop(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  const providerChain = buildProviderChain(config);
  let providerIndex = 0;
  let currentProvider = providerChain[0];

  // 动态重试上限（基于 provider 数量）
  const maxIterations = calculateMaxIterations(providerChain.length);

  // Provider 冷却期追踪
  const providerCooldowns = new Map<string, number>();

  // 状态 — ThinkLevel 渐进降级替代 boolean reasoning
  let thinkLevel: ThinkLevel = 'off'; // 默认关闭（大多数国产模型不支持）
  let messages: MessageSnapshot[] | undefined;
  let overloadAttempts = 0;
  let overflowCompactionAttempts = 0;

  log.info(
    `开始循环: providers=[${providerChain.map(p => `${p.provider}/${p.modelId}`).join(', ')}], ` +
    `maxIterations=${maxIterations}`,
  );

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // 检查外部中止
    if (abortSignal?.aborted) {
      log.warn('外部中止，退出循环');
      return;
    }

    log.info(`iteration ${iteration}/${maxIterations}: provider=${currentProvider.provider}/${currentProvider.modelId}, thinkLevel=${thinkLevel}`);

    const result = await runSingleAttempt({
      config,
      providerOverride: providerIndex > 0 ? currentProvider : undefined,
      thinkLevel,
      messagesOverride: messages,
      message,
      onEvent,
      abortSignal,
    });

    // ─── 成功 ───
    if (result.success) {
      log.info(`成功完成 (iteration=${iteration})`);
      return;
    }

    // ─── 超时或外部中止 → 不重试 ───
    if (result.timedOut || result.aborted) {
      if (result.timedOut) {
        emit(onEvent, { type: 'error', error: `Agent 执行超时${result.timedOutDuringCompaction ? '（compaction 期间）' : ''}` });
      }
      return;
    }

    // ─── 根据错误类型决定恢复策略 ───

    // Overload → 退避重试，连续 N 次后切 provider
    if (result.errorType === 'overload') {
      overloadAttempts++;
      if (result.messagesSnapshot) messages = result.messagesSnapshot;

      if (overloadAttempts >= MAX_OVERLOAD_BEFORE_FAILOVER) {
        const nextProvider = findNextProvider(providerChain, providerIndex, providerCooldowns);
        if (nextProvider !== null) {
          // 记录当前 provider 冷却
          providerCooldowns.set(currentProvider.provider, Date.now());
          providerIndex = nextProvider;
          currentProvider = providerChain[providerIndex];
          overloadAttempts = 0;
          overflowCompactionAttempts = 0;
          log.warn(
            `overload 重试耗尽 (${MAX_OVERLOAD_BEFORE_FAILOVER} 次)，切换到 ` +
            `${currentProvider.provider}/${currentProvider.modelId} (携带 ${messages?.length ?? 0} 条历史消息)`,
          );
          continue;
        }
        log.warn(`overload 重试耗尽但无可用备选 provider，继续退避当前 provider`);
      }

      const delay = calculateBackoff(overloadAttempts, { maxDelayMs: 5000 });
      log.warn(`overload，${delay.toFixed(0)}ms 后重试 (${iteration}/${maxIterations})`);
      await sleep(delay);
      continue;
    }

    // Billing/Auth → 立即切 provider
    if (result.errorType === 'billing' || result.errorType === 'auth') {
      providerCooldowns.set(currentProvider.provider, Date.now());
      const nextProvider = findNextProvider(providerChain, providerIndex, providerCooldowns);
      if (nextProvider !== null) {
        providerIndex = nextProvider;
        currentProvider = providerChain[providerIndex];
        overflowCompactionAttempts = 0;
        if (result.messagesSnapshot) messages = result.messagesSnapshot;
        log.warn(
          `${result.errorType} 错误，切换到 ${currentProvider.provider}/${currentProvider.modelId} ` +
          `(携带 ${messages?.length ?? 0} 条历史消息)`,
        );
        continue;
      }
      // 所有 provider 都失败
      emit(onEvent, { type: 'error', error: `所有 AI 服务不可用: ${result.error}` });
      return;
    }

    // Thinking 不支持 → 渐进降级 ThinkLevel
    if (result.errorType === 'thinking') {
      const prevLevel = thinkLevel;
      thinkLevel = degradeThinkLevel(thinkLevel);
      log.warn(`thinking 错误，降级 ${prevLevel} → ${thinkLevel}`);
      continue;
    }

    // Context overflow → 裁剪消息 + tool result 截断
    if (result.errorType === 'overflow' && overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
      overflowCompactionAttempts++;

      // Step 1: 裁剪消息（保留最近 12 条）
      const snapshot = result.messagesSnapshot ?? messages;
      messages = snapshot ? snapshot.slice(-12) : undefined;

      // Step 2: 第 2 次 overflow 起，额外截断过大的 tool result
      if (overflowCompactionAttempts >= 2 && messages) {
        messages = truncateOversizedToolResults(messages, 10_000);
      }

      log.warn(
        `context overflow，裁剪消息重试 (compaction attempt ${overflowCompactionAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}, ` +
        `保留 ${messages?.length ?? 0} 条消息)`,
      );
      continue;
    }

    // ─── 不可恢复 → 返回错误 ───
    log.error(`不可恢复错误: type=${result.errorType}, msg=${result.error}`);
    emit(onEvent, { type: 'error', error: `Agent 执行失败: ${result.error}` });
    return;
  }

  log.error(`已达最大重试次数 (${maxIterations})`);
  emit(onEvent, { type: 'error', error: `Agent 执行失败: 已达最大重试次数 (${maxIterations})` });
}

/**
 * 查找下一个可用的 provider（跳过冷却期内的）
 *
 * @returns provider 索引，或 null 如果没有可用的
 */
function findNextProvider(
  chain: ProviderConfig[],
  currentIndex: number,
  cooldowns: Map<string, number>,
): number | null {
  const now = Date.now();
  for (let i = currentIndex + 1; i < chain.length; i++) {
    const lastFail = cooldowns.get(chain[i].provider);
    if (lastFail === undefined || now - lastFail >= PROVIDER_COOLDOWN_MS) {
      return i;
    }
  }
  return null;
}
