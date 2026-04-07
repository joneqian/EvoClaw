/**
 * Prompt Cache 断裂检测
 *
 * 参考 Claude Code promptCacheBreakDetection.ts (727 行):
 * - 每次 API 调用前记录影响缓存键的状态
 * - API 调用后检测 cache_read_tokens 是否显著下降
 * - 断裂时分析根因（system prompt 变化、工具变化、模型变化等）
 *
 * 断裂条件: tokenDrop ≥ 2000 且 newCacheRead < prevCacheRead * 0.95
 */

import { createLogger } from '../../infrastructure/logger.js';
import { fastHash } from '../../infrastructure/runtime.js';

const log = createLogger('cache-monitor');

/** 最小忽略阈值 — 小于此值的 cache drop 不算断裂 */
const MIN_DROP_THRESHOLD = 2_000;

/** 最小下降比例 — 需要 >5% 的下降才触发 */
const MIN_DROP_RATIO = 0.95;

/** 影响缓存键的状态快照 */
interface CacheKeyState {
  systemPromptHash: string;
  toolSchemaHash: string;
  toolCount: number;
  modelId: string;
  thinkingEnabled: boolean;
  /** 逐工具哈希（用于精确定位哪个工具变了） */
  perToolHashes: Map<string, string>;
}

/** 断裂检测结果 */
export interface CacheBreakResult {
  detected: boolean;
  tokenDrop: number;
  prevCacheRead: number;
  newCacheRead: number;
  reasons: string[];
}

export class PromptCacheMonitor {
  private prevCacheReadTokens: number | null = null;
  private prevState: CacheKeyState | null = null;
  /** 压缩后抑制一次断裂检测 */
  private suppressNextCheck = false;

  /**
   * Latch 锁存: 首次构建的静态段落 hash
   *
   * 参考 Claude Code 的 TTL Latch 机制:
   * 首次计算后锁存，防止 session 中途 system prompt 意外变化导致缓存击穿。
   * 一次击穿约浪费整个 system prompt 的 token 重写费用。
   *
   * 用法: 首次 recordPreCallState 时锁存 systemPromptHash，
   * 后续调用若 hash 变化则记录警告（可选锁存阻止变化）。
   */
  private latchedSystemPromptHash: string | null = null;
  private latchedToolSchemaHash: string | null = null;

  /**
   * Phase 1: API 调用前记录状态
   */
  recordPreCallState(params: {
    systemPrompt: string;
    tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
    modelId: string;
    thinkingEnabled: boolean;
  }): void {
    const perToolHashes = new Map<string, string>();
    const toolParts: string[] = [];

    for (const tool of params.tools) {
      const toolStr = `${tool.name}:${tool.description}:${JSON.stringify(tool.inputSchema)}`;
      const hash = fastHash(toolStr);
      perToolHashes.set(tool.name, hash);
      toolParts.push(hash);
    }

    const systemPromptHash = fastHash(params.systemPrompt);
    const toolSchemaHash = fastHash(toolParts.join('|'));

    // Latch 锁存: 首次调用时记录基准 hash
    if (this.latchedSystemPromptHash === null) {
      this.latchedSystemPromptHash = systemPromptHash;
      this.latchedToolSchemaHash = toolSchemaHash;
    } else {
      // 后续调用: 检测意外变化
      if (systemPromptHash !== this.latchedSystemPromptHash) {
        log.warn(
          'Latch 警告: system prompt 在 session 中途发生变化（可能导致缓存击穿）',
        );
      }
      if (toolSchemaHash !== this.latchedToolSchemaHash) {
        log.warn(
          'Latch 警告: 工具 schema 在 session 中途发生变化（可能导致缓存击穿）',
        );
      }
    }

    this.prevState = {
      systemPromptHash,
      toolSchemaHash,
      toolCount: params.tools.length,
      modelId: params.modelId,
      thinkingEnabled: params.thinkingEnabled,
      perToolHashes,
    };
  }

  /**
   * Phase 2: API 调用后检测断裂
   */
  checkForBreak(params: {
    cacheReadTokens: number;
    cacheWriteTokens: number;
    systemPrompt: string;
    tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
    modelId: string;
    thinkingEnabled: boolean;
  }): CacheBreakResult {
    const result: CacheBreakResult = {
      detected: false,
      tokenDrop: 0,
      prevCacheRead: this.prevCacheReadTokens ?? 0,
      newCacheRead: params.cacheReadTokens,
      reasons: [],
    };

    // 首次调用或压缩后抑制
    if (this.prevCacheReadTokens === null || this.suppressNextCheck) {
      this.prevCacheReadTokens = params.cacheReadTokens;
      this.suppressNextCheck = false;
      return result;
    }

    // 计算 drop
    const tokenDrop = this.prevCacheReadTokens - params.cacheReadTokens;
    result.tokenDrop = tokenDrop;

    // 检测断裂: drop ≥ 2000 且 >5% 下降
    if (tokenDrop >= MIN_DROP_THRESHOLD && params.cacheReadTokens < this.prevCacheReadTokens * MIN_DROP_RATIO) {
      result.detected = true;
      result.reasons = this.analyzeReasons(params);

      log.warn(
        `Prompt Cache 断裂: drop=${tokenDrop} tokens (${this.prevCacheReadTokens} → ${params.cacheReadTokens}), ` +
        `原因: [${result.reasons.join(', ')}]`,
      );
    }

    this.prevCacheReadTokens = params.cacheReadTokens;
    return result;
  }

  /** 压缩后通知 — 抑制下一次断裂检测 */
  notifyCompaction(): void {
    this.prevCacheReadTokens = null;
    this.suppressNextCheck = true;
  }

  /**
   * 缓存前内容修改通知 — 抑制因修改缓存前消息导致的断裂报警
   *
   * 当 microcompactCacheAware Phase 2 修改了缓存断点前的消息时调用。
   * 与 notifyCompaction() 类似，但不清除 prevCacheReadTokens（仅抑制检测）。
   */
  notifyCacheDeletion(): void {
    this.suppressNextCheck = true;
  }

  /** 重置状态（新会话） */
  reset(): void {
    this.prevCacheReadTokens = null;
    this.prevState = null;
    this.suppressNextCheck = false;
    this.latchedSystemPromptHash = null;
    this.latchedToolSchemaHash = null;
  }

  /** 获取 Latch 状态（调试用） */
  getLatchState(): { systemPromptHash: string | null; toolSchemaHash: string | null } {
    return {
      systemPromptHash: this.latchedSystemPromptHash,
      toolSchemaHash: this.latchedToolSchemaHash,
    };
  }

  // ─── Private ───

  private analyzeReasons(current: {
    systemPrompt: string;
    tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[];
    modelId: string;
    thinkingEnabled: boolean;
  }): string[] {
    if (!this.prevState) return ['首次检测，无对比数据'];

    const reasons: string[] = [];

    // 模型变更
    if (current.modelId !== this.prevState.modelId) {
      reasons.push(`模型变更: ${this.prevState.modelId} → ${current.modelId}`);
    }

    // Thinking 切换
    if (current.thinkingEnabled !== this.prevState.thinkingEnabled) {
      reasons.push(`思考模式: ${this.prevState.thinkingEnabled} → ${current.thinkingEnabled}`);
    }

    // System prompt 变化
    const newSysHash = fastHash(current.systemPrompt);
    if (newSysHash !== this.prevState.systemPromptHash) {
      reasons.push('系统提示词内容变化');
    }

    // 工具数量变化
    if (current.tools.length !== this.prevState.toolCount) {
      reasons.push(`工具数量: ${this.prevState.toolCount} → ${current.tools.length}`);
    }

    // 工具 schema 变化（精确到具体工具）
    const newPerToolHashes = new Map<string, string>();
    for (const tool of current.tools) {
      const toolStr = `${tool.name}:${tool.description}:${JSON.stringify(tool.inputSchema)}`;
      newPerToolHashes.set(tool.name, fastHash(toolStr));
    }

    const changedTools: string[] = [];
    for (const [name, hash] of newPerToolHashes) {
      const prevHash = this.prevState.perToolHashes.get(name);
      if (prevHash && prevHash !== hash) {
        changedTools.push(name);
      }
    }
    if (changedTools.length > 0) {
      reasons.push(`工具 schema 变化: [${changedTools.join(', ')}]`);
    }

    // 新增工具
    const addedTools = [...newPerToolHashes.keys()].filter(n => !this.prevState!.perToolHashes.has(n));
    if (addedTools.length > 0) {
      reasons.push(`新增工具: [${addedTools.join(', ')}]`);
    }

    // 删除工具
    const removedTools = [...this.prevState.perToolHashes.keys()].filter(n => !newPerToolHashes.has(n));
    if (removedTools.length > 0) {
      reasons.push(`删除工具: [${removedTools.join(', ')}]`);
    }

    if (reasons.length === 0) {
      reasons.push('原因未知（可能是 TTL 过期或消息变化）');
    }

    return reasons;
  }
}
