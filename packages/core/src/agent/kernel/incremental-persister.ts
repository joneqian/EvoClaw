/**
 * 增量持久化器 — queryLoop 逐轮消息写入 SQLite
 *
 * 核心策略:
 * - 100ms 批量写入，利用 SQLite WAL 模式高并发写入能力
 * - try-catch 包裹，写入失败不阻塞 Agent 循环
 * - flush() 同步写入，供优雅关闭和异常退出路径调用
 * - 崩溃后 orphaned 消息可自动恢复
 *
 * 生命周期: runSingleAttempt 创建 → queryLoop 使用 → finally flush → finalize/dispose
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import type { KernelMessage } from './types.js';
import { createLogger } from '../../infrastructure/logger.js';
import { registerActivePersister, unregisterActivePersister } from '../../infrastructure/graceful-shutdown.js';

const log = createLogger('incremental-persister');

/** 批量刷盘间隔 (ms) */
const FLUSH_INTERVAL_MS = 100;

/** 待写入条目 */
interface PendingEntry {
  readonly id: string;
  readonly agentId: string;
  readonly sessionKey: string;
  readonly role: string;
  readonly content: string;
  readonly turnIndex: number;
  readonly kernelMessageJson: string;
}

/**
 * 增量持久化器
 *
 * 在 queryLoop 每轮消息产生后，将 KernelMessage 异步批量写入 SQLite。
 * 崩溃后残留的 streaming 记录可通过 loadOrphaned() 恢复。
 */
export class IncrementalPersister {
  private readonly queue: PendingEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** 本次执行批次 ID — 用于 finalize 时精确定位 */
  private readonly batchId: string;

  constructor(
    private readonly store: SqliteStore,
    private readonly agentId: string,
    private readonly sessionKey: string,
  ) {
    this.batchId = crypto.randomUUID();
    registerActivePersister(this);
  }

  /**
   * 记录一轮的消息（assistant + tool_result）
   *
   * 消息进入内存队列，100ms 后批量写入 SQLite。
   * 写入失败仅 log.warn，不抛异常。
   */
  persistTurn(turnIndex: number, messages: readonly KernelMessage[]): void {
    if (this.disposed) return;

    for (const msg of messages) {
      this.queue.push({
        id: `${this.batchId}:${turnIndex}:${msg.id}`,
        agentId: this.agentId,
        sessionKey: this.sessionKey,
        role: msg.role,
        content: extractDisplayContent(msg),
        turnIndex,
        kernelMessageJson: JSON.stringify(msg),
      });
    }

    this.scheduleDrain();
  }

  /**
   * 同步 flush 所有待写入数据
   *
   * 用于:
   * - 优雅关闭 (SIGTERM/SIGINT)
   * - runSingleAttempt finally 块
   * - 异常退出前最后一搏
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.drainQueue();
  }

  /**
   * 标记本次执行的所有 streaming → final
   *
   * 在 queryLoop 正常结束时调用。
   */
  finalize(): void {
    // 先 flush 残余
    this.flush();

    try {
      this.store.run(
        `UPDATE conversation_log
         SET persist_status = 'final'
         WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'
           AND id LIKE ?`,
        this.agentId,
        this.sessionKey,
        `${this.batchId}:%`,
      );
    } catch (err) {
      log.warn(`finalize 失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.flush();
    this.disposed = true;
    unregisterActivePersister(this);
  }

  // ─── Static: 崩溃恢复 ───

  /**
   * 加载上次崩溃残留的 streaming 消息
   *
   * 将 streaming → orphaned，然后反序列化为 KernelMessage[]。
   * 调用方可将这些消息合并到历史中。
   */
  static loadOrphaned(
    store: SqliteStore,
    agentId: string,
    sessionKey: string,
  ): KernelMessage[] {
    // 标记残留为 orphaned
    store.run(
      `UPDATE conversation_log
       SET persist_status = 'orphaned'
       WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'`,
      agentId,
      sessionKey,
    );

    // 加载 orphaned 消息
    const rows = store.all<{ kernel_message_json: string; turn_index: number }>(
      `SELECT kernel_message_json, turn_index
       FROM conversation_log
       WHERE agent_id = ? AND session_key = ? AND persist_status = 'orphaned'
         AND kernel_message_json IS NOT NULL
       ORDER BY turn_index ASC, rowid ASC`,
      agentId,
      sessionKey,
    );

    if (rows.length === 0) return [];

    log.info(`恢复 ${rows.length} 条 orphaned 消息 (agent=${agentId}, session=${sessionKey})`);

    const messages: KernelMessage[] = [];
    for (const row of rows) {
      try {
        messages.push(JSON.parse(row.kernel_message_json) as KernelMessage);
      } catch {
        log.warn(`orphaned 消息反序列化失败，跳过`);
      }
    }

    // 标记为 final（已恢复）
    store.run(
      `UPDATE conversation_log
       SET persist_status = 'final'
       WHERE agent_id = ? AND session_key = ? AND persist_status = 'orphaned'`,
      agentId,
      sessionKey,
    );

    return messages;
  }

  // ─── Private ───

  private scheduleDrain(): void {
    if (this.flushTimer || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.drainQueue();
    }, FLUSH_INTERVAL_MS);
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);

    try {
      this.store.transaction(() => {
        for (const entry of batch) {
          this.store.run(
            `INSERT OR IGNORE INTO conversation_log
             (id, agent_id, session_key, role, content, turn_index, kernel_message_json, persist_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'streaming', datetime('now'))`,
            entry.id,
            entry.agentId,
            entry.sessionKey,
            entry.role,
            entry.content,
            entry.turnIndex,
            entry.kernelMessageJson,
          );
        }
      });
    } catch (err) {
      log.warn(`批量写入失败 (${batch.length} 条): ${err instanceof Error ? err.message : err}`);
      // 不重试，不阻塞 — 降级跳过
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 显示文本提取
// ═══════════════════════════════════════════════════════════════════════════

/** 旧版占位符格式（v1）— 用于识别存量坏数据 */
const LEGACY_PLACEHOLDER_RE = /^\[(\w+) message with (\d+) blocks\]$/;

/** 单条块摘要最大长度（避免 content 过长） */
const BLOCK_SUMMARY_MAX_CHARS = 200;

/**
 * 从 KernelMessage 提取用户可见的显示文本
 *
 * 规则（按优先级）：
 * 1. 有 text 块 → 直接拼接所有 text 块内容
 * 2. 无 text 块 → 按块类型生成摘要：
 *    - thinking → `[思考] <前 N 字>`
 *    - tool_use → `[调用 <name>] <参数摘要>`
 *    - tool_result → `[工具结果] <前 N 字>` 或 `[工具错误] ...`
 *    - image → `[图片]`
 *    - redacted_thinking → `[思考]`（签名内容不可解码）
 * 3. 无任何块 → 空字符串（前端 MessageBubble 会显示"正在思考..."占位）
 */
export function extractDisplayContent(msg: KernelMessage): string {
  // 优先提取 text 块
  const texts = msg.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .filter(t => t.trim().length > 0);

  if (texts.length > 0) return texts.join('\n');

  // 无 text 块 — 按块类型拼接摘要
  const parts: string[] = [];
  for (const block of msg.content) {
    const summary = summarizeBlock(block);
    if (summary) parts.push(summary);
  }
  return parts.join(' · ');
}

/**
 * 从存量占位符 + kernel_message_json 重建显示文本
 *
 * 用于修复先前写入的 `[xxx message with N blocks]` 坏数据。
 * 若 content 不是占位符则原样返回；若 JSON 解析失败也返回原 content。
 */
export function reconstructDisplayContent(
  content: string,
  kernelMessageJson: string | null | undefined,
): string {
  if (!content || !LEGACY_PLACEHOLDER_RE.test(content.trim())) return content;
  if (!kernelMessageJson) return content;
  try {
    const msg = JSON.parse(kernelMessageJson) as KernelMessage;
    const rebuilt = extractDisplayContent(msg);
    return rebuilt || content;
  } catch {
    return content;
  }
}

/** 单个块的人类可读摘要 */
function summarizeBlock(block: KernelMessage['content'][number]): string {
  switch (block.type) {
    case 'text':
      return truncate((block as { text: string }).text, BLOCK_SUMMARY_MAX_CHARS);
    case 'thinking': {
      const text = (block as { thinking: string }).thinking?.trim() ?? '';
      return text ? `[思考] ${truncate(text, 80)}` : '[思考]';
    }
    case 'redacted_thinking':
      return '[思考]';
    case 'tool_use': {
      const name = (block as { name: string }).name ?? '未知工具';
      const input = (block as { input: Record<string, unknown> }).input ?? {};
      const argSummary = summarizeToolInput(input);
      return argSummary ? `[调用 ${name}] ${argSummary}` : `[调用 ${name}]`;
    }
    case 'tool_result': {
      const content = (block as { content: string; is_error?: boolean });
      const prefix = content.is_error ? '[工具错误]' : '[工具结果]';
      const text = typeof content.content === 'string' ? content.content : '';
      return text ? `${prefix} ${truncate(text, 120)}` : prefix;
    }
    case 'image':
      return '[图片]';
    default:
      return '';
  }
}

/** 工具参数摘要 — 提取最有信息量的字段 */
function summarizeToolInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return '';

  // 优先字段（大多数工具的主参数）
  const priorityKeys = ['task', 'command', 'file_path', 'path', 'query', 'url', 'pattern'];
  for (const key of priorityKeys) {
    if (key in input && typeof input[key] === 'string') {
      return truncate(input[key] as string, 80);
    }
  }

  // 回退：第一个字符串字段
  for (const key of keys) {
    const v = input[key];
    if (typeof v === 'string' && v.length > 0) {
      return truncate(v, 80);
    }
  }

  return `${keys.length} 个参数`;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max) + '…';
}
