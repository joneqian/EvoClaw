/**
 * AutoDream 记忆整合器 — 定期合并重复/矛盾记忆，维护记忆质量
 *
 * 参考 Claude Code 的 AutoDream 机制:
 * - 24h + 5 新会话触发
 * - 4 阶段 LLM 驱动（Orient → Gather → Consolidate → Prune）
 * - 锁机制多进程安全
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MemoryUnit } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryStore } from './memory-store.js';
import { FtsStore } from '../infrastructure/db/fts-store.js';
import { buildConsolidationPrompt, type MemoryStats } from './consolidation-prompt.js';
import type { LLMCallFn } from './memory-extractor.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('memory-consolidator');

/** 整合结果 */
export interface ConsolidationResult {
  merged: number;
  pruned: number;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

/** 整合配置 */
export interface ConsolidatorOptions {
  /** 距上次整合的最小间隔小时数（默认 24） */
  cooldownHours?: number;
  /** 触发整合的最少新会话数（默认 5） */
  minSessionsSinceLast?: number;
  /** 锁文件有效期小时数（默认 1） */
  lockTimeoutHours?: number;
}

export class MemoryConsolidator {
  private store: MemoryStore;
  private ftsStore?: FtsStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly cooldownHours: number;
  private readonly minSessions: number;
  private readonly lockTimeoutHours: number;

  constructor(
    private db: SqliteStore,
    private llmCall: LLMCallFn,
    private dataDir: string,
    options?: ConsolidatorOptions,
    ftsStore?: FtsStore,
  ) {
    this.store = new MemoryStore(db);
    this.ftsStore = ftsStore;
    this.cooldownHours = options?.cooldownHours ?? 24;
    this.minSessions = options?.minSessionsSinceLast ?? 5;
    this.lockTimeoutHours = options?.lockTimeoutHours ?? 1;
  }

  /** 启动定时检查（默认每小时） */
  start(intervalMs = 3600_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkAllAgents(), intervalMs);
    // 启动后延迟 5 分钟执行第一次（给系统启动留时间）
    setTimeout(() => this.checkAllAgents(), 300_000);
    log.info('AutoDream 整合调度已启动');
  }

  /** 停止定时检查 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 遍历所有 Agent，检查并执行整合 */
  private async checkAllAgents(): Promise<void> {
    try {
      const agents = this.db.all<{ id: string }>('SELECT id FROM agents');
      for (const agent of agents) {
        if (this.shouldRun(agent.id)) {
          log.info(`Agent ${agent.id} 满足整合条件，开始 AutoDream`);
          await this.consolidate(agent.id);
        }
      }
    } catch (err) {
      log.error(`AutoDream 检查失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 检查是否应对指定 Agent 执行整合 */
  shouldRun(agentId: string): boolean {
    // 1. 检查距上次整合的时间
    const lastRun = this.db.get<{ completed_at: string }>(
      `SELECT completed_at FROM consolidation_log
       WHERE agent_id = ? AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      agentId,
    );

    if (lastRun) {
      const hoursSince = (Date.now() - new Date(lastRun.completed_at).getTime()) / (1000 * 60 * 60);
      if (hoursSince < this.cooldownHours) {
        return false;
      }
    }

    // 2. 检查新会话数
    const sinceTime = lastRun?.completed_at ?? '1970-01-01T00:00:00Z';
    const sessionCount = this.db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT session_key) as count FROM conversation_log
       WHERE agent_id = ? AND created_at > ?`,
      agentId,
      sinceTime,
    );

    if ((sessionCount?.count ?? 0) < this.minSessions) {
      return false;
    }

    // 3. 检查锁
    if (!this.acquireLock(agentId)) {
      return false;
    }

    return true;
  }

  /** 执行 4 阶段整合 */
  async consolidate(agentId: string): Promise<ConsolidationResult> {
    const logId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    // 写入整合日志（running 状态）
    this.db.run(
      `INSERT INTO consolidation_log (id, agent_id, started_at, status) VALUES (?, ?, ?, 'running')`,
      logId, agentId, startedAt,
    );

    try {
      // === Phase 1: Orient — 加载记忆统计 ===
      const memories = this.store.listByAgent(agentId, { limit: 500 });
      if (memories.length < 5) {
        log.info(`Agent ${agentId} 记忆不足 5 条，跳过整合`);
        this.updateLog(logId, 'completed', 0, 0);
        this.releaseLock(agentId);
        return { merged: 0, pruned: 0, status: 'skipped' };
      }

      const stats = this.computeStats(memories);
      log.info(`Phase 1 Orient: ${memories.length} 条记忆, ${stats.duplicateMergeKeys.length} 组重复, ${stats.lowActivation.length} 条低活跃`);

      // 如果无需整合（无重复、无低活跃），提前返回
      if (stats.duplicateMergeKeys.length === 0 && stats.lowActivation.length === 0) {
        log.info(`Agent ${agentId} 无需整合`);
        this.updateLog(logId, 'completed', 0, 0);
        this.releaseLock(agentId);
        return { merged: 0, pruned: 0, status: 'skipped' };
      }

      // === Phase 2: Gather — 收集候选记忆（限定范围给 LLM） ===
      const candidateIds = new Set<string>();
      for (const dup of stats.duplicateMergeKeys) {
        for (const id of dup.ids) candidateIds.add(id);
      }
      for (const low of stats.lowActivation) {
        candidateIds.add(low.id);
      }
      const candidates = memories.filter(m => candidateIds.has(m.id));
      log.info(`Phase 2 Gather: ${candidates.length} 条候选记忆`);

      // === Phase 3: Consolidate — LLM 生成整合指令 ===
      const { system, user } = buildConsolidationPrompt(candidates, stats);
      let llmResponse: string;
      try {
        llmResponse = await this.llmCall(system, user);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`LLM 调用失败: ${errMsg}`);
        this.updateLog(logId, 'failed', 0, 0, errMsg);
        this.releaseLock(agentId);
        return { merged: 0, pruned: 0, status: 'failed', error: errMsg };
      }

      // === Phase 4: Prune — 解析并执行指令 ===
      const instructions = this.parseConsolidationXml(llmResponse);
      let merged = 0;
      let pruned = 0;

      this.db.transaction(() => {
        // 执行合并
        for (const merge of instructions.merges) {
          const target = this.store.getById(merge.targetId);
          const source = this.store.getById(merge.sourceId);
          if (!target || !source) continue;

          // 更新 target 的 L1/L2
          this.store.update(merge.targetId, {
            l1Overview: merge.l1Overview,
            l2Content: merge.l2Content,
          });

          // 更新 FTS 索引
          if (this.ftsStore) {
            this.ftsStore.indexMemory(merge.targetId, target.l0Index, merge.l1Overview);
          }

          // 归档 source
          this.store.archive(merge.sourceId);
          merged++;
          log.debug(`合并: ${merge.sourceId} → ${merge.targetId}`);
        }

        // 执行归档
        for (const archive of instructions.archives) {
          this.store.archive(archive.id);
          pruned++;
          log.debug(`归档: ${archive.id} (${archive.reason})`);
        }
      });

      log.info(`Phase 4 Prune: 合并 ${merged} 条, 归档 ${pruned} 条`);
      this.updateLog(logId, 'completed', merged, pruned);
      this.releaseLock(agentId);

      return { merged, pruned, status: 'completed' };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`整合失败: ${errMsg}`);
      this.updateLog(logId, 'failed', 0, 0, errMsg);
      this.releaseLock(agentId);
      return { merged: 0, pruned: 0, status: 'failed', error: errMsg };
    }
  }

  /** 计算记忆统计信息 */
  private computeStats(memories: MemoryUnit[]): MemoryStats {
    const byCategory: Record<string, number> = {};
    const mergeKeyGroups = new Map<string, string[]>();

    for (const m of memories) {
      byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
      if (m.mergeKey) {
        const group = mergeKeyGroups.get(m.mergeKey) ?? [];
        group.push(m.id);
        mergeKeyGroups.set(m.mergeKey, group);
      }
    }

    const duplicateMergeKeys = [...mergeKeyGroups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([mergeKey, ids]) => ({ mergeKey, count: ids.length, ids }));

    const now = Date.now();
    const lowActivation = memories
      .filter(m => m.activation < 0.1)
      .map(m => ({
        id: m.id,
        activation: m.activation,
        daysSinceAccess: Math.floor((now - new Date(m.updatedAt).getTime()) / (1000 * 60 * 60 * 24)),
      }));

    return {
      totalCount: memories.length,
      byCategory,
      duplicateMergeKeys,
      lowActivation,
    };
  }

  /** 解析整合指令 XML */
  private parseConsolidationXml(xml: string): {
    merges: { sourceId: string; targetId: string; l1Overview: string; l2Content: string }[];
    archives: { id: string; reason: string }[];
  } {
    const merges: { sourceId: string; targetId: string; l1Overview: string; l2Content: string }[] = [];
    const archives: { id: string; reason: string }[] = [];

    // 检查无需整合
    if (xml.includes('<no_consolidation/>') || xml.includes('<no_consolidation />')) {
      return { merges, archives };
    }

    // 解析 <merge>
    const mergeRe = /<merge\s+source_id="([^"]+)"\s+target_id="([^"]+)">([\s\S]*?)<\/merge>/g;
    let match: RegExpExecArray | null;
    while ((match = mergeRe.exec(xml)) !== null) {
      const [, sourceId, targetId, body] = match;
      const l1 = body!.match(/<l1_overview>([\s\S]*?)<\/l1_overview>/)?.[1]?.trim() ?? '';
      const l2 = body!.match(/<l2_content>([\s\S]*?)<\/l2_content>/)?.[1]?.trim() ?? '';
      if (sourceId && targetId && l1) {
        merges.push({ sourceId, targetId, l1Overview: l1, l2Content: l2 });
      }
    }

    // 解析 <archive>
    const archiveRe = /<archive\s+id="([^"]+)"\s+reason="([^"]+)"\s*\/>/g;
    while ((match = archiveRe.exec(xml)) !== null) {
      const [, id, reason] = match;
      if (id && reason) {
        archives.push({ id, reason });
      }
    }

    return { merges, archives };
  }

  /** 获取锁 */
  private acquireLock(agentId: string): boolean {
    const lockPath = this.getLockPath(agentId);
    try {
      // 检查是否已有锁
      if (fs.existsSync(lockPath)) {
        const stat = fs.statSync(lockPath);
        const lockAge = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

        // 锁未超时 → 跳过
        if (lockAge < this.lockTimeoutHours) {
          // 检查持有者进程是否还活着
          const pid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
          if (!isNaN(pid)) {
            try {
              process.kill(pid, 0); // 检查进程是否存在
              log.debug(`锁被 PID ${pid} 持有且进程存活，跳过`);
              return false;
            } catch {
              // 进程不存在 → 接管锁
              log.info(`锁持有者 PID ${pid} 已不存在，接管`);
            }
          }
        } else {
          log.info(`锁已超时 ${lockAge.toFixed(1)}h，接管`);
        }
      }

      // 确保目录存在
      const dir = path.dirname(lockPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入锁
      fs.writeFileSync(lockPath, String(process.pid));
      return true;
    } catch (err) {
      log.error(`获取锁失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** 释放锁 */
  private releaseLock(agentId: string): void {
    const lockPath = this.getLockPath(agentId);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // 忽略删除失败
    }
  }

  /** 锁文件路径 */
  private getLockPath(agentId: string): string {
    return path.join(this.dataDir, 'agents', agentId, '.consolidation.lock');
  }

  /** 更新整合日志 */
  private updateLog(logId: string, status: string, merged: number, pruned: number, error?: string): void {
    this.db.run(
      `UPDATE consolidation_log SET
        status = ?, completed_at = ?, memories_merged = ?, memories_pruned = ?, error_message = ?
       WHERE id = ?`,
      status, new Date().toISOString(), merged, pruned, error ?? null, logId,
    );
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }
}
