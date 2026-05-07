/**
 * Checkpoint Manager — 高层 API：create / revert / listRecent / GC
 *
 * 职责：
 * - 工具调用前 createCheckpoint：读被改文件 → 写 object → 登记 checkpoint_log
 * - 工具失败 / 用户主动 revert → revertCheckpoint：从 object 恢复每个文件
 * - listRecent：UI / agent 自助查询最近 N 个 checkpoint
 * - gc：删 7 天前已 reverted 的 ref + 孤儿 objects
 *
 * **重要**：本 manager 不直接拦截工具——由 builtin-tools.ts 在 write/edit 进入实际
 * 写文件之前主动调 createCheckpoint。失败时 manager 也不主动 revert（工具自己已经
 * 失败，用户决定回滚）；后续可在 PostToolUse hook 加自动 revert 策略。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { createLogger } from '../../infrastructure/logger.js';
import { CheckpointStore, hashContent } from './checkpoint-store.js';

const log = createLogger('checkpoint-manager');

/** 单个 checkpoint 中被改文件的快照元信息 */
export interface CheckpointFileSnapshot {
  /** 绝对路径（revert 时直接写回此路径） */
  path: string;
  /** 改前内容的 sha256（必填，revert 用） */
  shaBefore: string;
  /** 文件改前是否存在（false = 工具新建文件，revert = 删除） */
  existedBefore: boolean;
}

/** Checkpoint 完整记录（DB 行 + 解析后的 files） */
export interface CheckpointRecord {
  toolInvocationId: string;
  toolName: string;
  agentId: string | null;
  sessionKey: string | null;
  toolStatus: string | null;
  files: CheckpointFileSnapshot[];
  createdAt: number;
  revertedAt: number | null;
}

/** DB 行原始结构 */
interface CheckpointRow {
  tool_invocation_id: string;
  agent_id: string | null;
  session_key: string | null;
  tool_name: string;
  files_json: string;
  tool_status: string | null;
  created_at: number;
  reverted_at: number | null;
}

function parseRow(row: CheckpointRow): CheckpointRecord {
  let files: CheckpointFileSnapshot[] = [];
  try {
    files = JSON.parse(row.files_json) as CheckpointFileSnapshot[];
  } catch (err) {
    log.warn(
      `[manager] 解析 files_json 失败 invocation=${row.tool_invocation_id}: ${(err as Error).message}`,
    );
  }
  return {
    toolInvocationId: row.tool_invocation_id,
    toolName: row.tool_name,
    agentId: row.agent_id,
    sessionKey: row.session_key,
    toolStatus: row.tool_status,
    files,
    createdAt: row.created_at,
    revertedAt: row.reverted_at,
  };
}

export interface CreateCheckpointInput {
  toolInvocationId: string;
  toolName: string;
  /** 即将被改的文件绝对路径列表（write/edit 提供单个；apply_patch 可多个） */
  filePaths: string[];
  agentId?: string;
  sessionKey?: string;
}

export interface CheckpointManagerOptions {
  /** 可选注入测试 store（默认 new CheckpointStore()） */
  store?: CheckpointStore;
}

/** 默认保留窗口：7 天前已 reverted 的可清理 */
const DEFAULT_GC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class CheckpointManager {
  private readonly store: CheckpointStore;

  constructor(
    private readonly db: SqliteStore,
    options: CheckpointManagerOptions = {},
  ) {
    this.store = options.store ?? new CheckpointStore();
  }

  /** 暴露 store 给 GC 路由 / 诊断 */
  get checkpointStore(): CheckpointStore {
    return this.store;
  }

  /**
   * 创建 checkpoint：读所有 filePath 当前内容 → 写 object → 登记 DB
   *
   * 已存在的文件：sha256 命中复用 object。
   * 不存在的文件：标记 existedBefore=false，revert 时即"删除"语义。
   *
   * 失败保护：单个文件读失败时跳过该文件（log.warn），不阻塞其他文件，
   * 让工具调用本身能继续执行。
   */
  async create(input: CreateCheckpointInput): Promise<CheckpointRecord> {
    const snapshots: CheckpointFileSnapshot[] = [];

    for (const filePath of input.filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          const sha = this.store.writeObject(buf);
          snapshots.push({ path: filePath, shaBefore: sha, existedBefore: true });
        } else {
          // 文件原本不存在：用空 sha256（hashContent('') 的固定值）作 sentinel
          // existedBefore=false 让 revert 走"删除"路径
          snapshots.push({
            path: filePath,
            shaBefore: hashContent(Buffer.alloc(0)),
            existedBefore: false,
          });
        }
      } catch (err) {
        log.warn(
          `[manager] 读取文件失败跳过 path=${filePath}: ${(err as Error).message}`,
        );
      }
    }

    const now = Date.now();
    this.db.run(
      `INSERT INTO checkpoint_log (tool_invocation_id, agent_id, session_key, tool_name, files_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.toolInvocationId,
      input.agentId ?? null,
      input.sessionKey ?? null,
      input.toolName,
      JSON.stringify(snapshots),
      now,
    );

    log.info(
      `[manager] checkpoint 创建 invocation=${input.toolInvocationId} tool=${input.toolName} files=${snapshots.length}`,
    );

    return {
      toolInvocationId: input.toolInvocationId,
      toolName: input.toolName,
      agentId: input.agentId ?? null,
      sessionKey: input.sessionKey ?? null,
      toolStatus: null,
      files: snapshots,
      createdAt: now,
      revertedAt: null,
    };
  }

  /**
   * Revert checkpoint：把所有文件还原到 sha256_before 状态。
   *
   * - existedBefore=true → 写回 object 内容
   * - existedBefore=false → 删除文件（如果还存在）
   *
   * 幂等：第二次 revert 同 invocationId 直接返回已 revert 状态。
   *
   * @returns 实际还原 / 删除的文件数；记录不存在时返回 -1
   */
  async revert(toolInvocationId: string): Promise<number> {
    const row = this.db.get<CheckpointRow>(
      `SELECT * FROM checkpoint_log WHERE tool_invocation_id = ?`,
      toolInvocationId,
    );
    if (!row) {
      log.warn(`[manager] revert: invocation 未找到 ${toolInvocationId}`);
      return -1;
    }

    const record = parseRow(row);
    if (record.revertedAt !== null) {
      log.info(`[manager] revert 幂等：invocation=${toolInvocationId} 已撤销过`);
      return record.files.length;
    }

    let restored = 0;
    for (const snap of record.files) {
      try {
        if (snap.existedBefore) {
          if (!this.store.hasObject(snap.shaBefore)) {
            log.warn(
              `[manager] revert 跳过：object 已被 GC sha=${snap.shaBefore.slice(0, 12)}... path=${snap.path}`,
            );
            continue;
          }
          const buf = this.store.readObject(snap.shaBefore);
          fs.mkdirSync(path.dirname(snap.path), { recursive: true });
          fs.writeFileSync(snap.path, buf);
          restored += 1;
          log.info(`[manager] revert 还原 path=${snap.path} bytes=${buf.length}`);
        } else if (fs.existsSync(snap.path)) {
          // 改前不存在 → revert = 删除
          fs.unlinkSync(snap.path);
          restored += 1;
          log.info(`[manager] revert 删除（改前不存在） path=${snap.path}`);
        }
      } catch (err) {
        log.warn(
          `[manager] revert 单文件失败 path=${snap.path}: ${(err as Error).message}`,
        );
      }
    }

    this.db.run(
      `UPDATE checkpoint_log SET reverted_at = ? WHERE tool_invocation_id = ?`,
      Date.now(),
      toolInvocationId,
    );

    log.info(
      `[manager] revert 完成 invocation=${toolInvocationId} restored=${restored}/${record.files.length}`,
    );
    return restored;
  }

  /** 列出最近 N 条 checkpoint（默认 50） */
  listRecent(limit = 50): CheckpointRecord[] {
    const rows = this.db.all<CheckpointRow>(
      `SELECT * FROM checkpoint_log ORDER BY created_at DESC LIMIT ?`,
      limit,
    );
    return rows.map(parseRow);
  }

  /** 按 invocationId 查 */
  get(toolInvocationId: string): CheckpointRecord | null {
    const row = this.db.get<CheckpointRow>(
      `SELECT * FROM checkpoint_log WHERE tool_invocation_id = ?`,
      toolInvocationId,
    );
    return row ? parseRow(row) : null;
  }

  /**
   * GC：清理 N 天前已 reverted 的 ref + 没有任何 ref 的 object。
   *
   * 不动未 reverted 的 ref（用户可能还想撤销）。
   *
   * @returns 删除的 ref 数 + 孤儿 object 数
   */
  async gc(retentionMs: number = DEFAULT_GC_RETENTION_MS): Promise<{
    deletedRefs: number;
    deletedObjects: number;
  }> {
    const cutoff = Date.now() - retentionMs;

    // 1) 删旧的已 reverted ref
    const result = this.db.run(
      `DELETE FROM checkpoint_log WHERE reverted_at IS NOT NULL AND reverted_at < ?`,
      cutoff,
    );
    const deletedRefs = result.changes ?? 0;

    // 2) 收集仍被引用的 sha 集合
    const allRows = this.db.all<{ files_json: string }>(`SELECT files_json FROM checkpoint_log`);
    const referenced = new Set<string>();
    for (const r of allRows) {
      try {
        const files = JSON.parse(r.files_json) as CheckpointFileSnapshot[];
        for (const f of files) referenced.add(f.shaBefore);
      } catch {
        /* 跳过损坏行 */
      }
    }

    // 3) 删孤儿 object
    const deletedObjects = this.store.gcOrphans(referenced);

    log.info(
      `[manager] gc 完成 deletedRefs=${deletedRefs} deletedObjects=${deletedObjects} retentionDays=${retentionMs / 86400000}`,
    );
    return { deletedRefs, deletedObjects };
  }
}
