/**
 * Artifact Service —— Layer 2 中间产物存储与读取（M13 PR3）
 *
 * 职责：
 * - attachArtifact：写表（含 inline_content / metadata），支持 supersedes_id 简易版本链
 * - listTaskArtifacts(taskId | planId)：读
 * - fetchArtifact：按 mode 返回 summary 或全量内容
 *     - inline 直接返回
 *     - URI 走 ArtifactURIRegistry 分派到具体渠道 resolver
 * - GC：plan completed 30 天后清理本地缓存（仅清原始数据，DB 记录保留）
 *
 * 大小限制（与 plan 文档对齐）：
 *   - text 内联 ≤ 4KB
 *   - markdown 内联 ≤ 64KB
 *   - 其他 kind 必须用 URI（不允许 inline）
 *   - file 单文件 ≤ 100MB（超过走渠道云盘）
 */

import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { SqliteStore } from '../../../infrastructure/db/sqlite-store.js';
import { createLogger } from '../../../infrastructure/logger.js';
import { artifactURIRegistry, ArtifactURIRegistry } from './uri-resolver.js';
import type {
  Artifact,
  ArtifactKind,
  AttachArtifactArgs,
  FetchArtifactArgs,
  FetchedArtifact,
  TaskArtifactRow,
} from './types.js';

const logger = createLogger('team-mode/artifacts');

const TEXT_INLINE_MAX = 4 * 1024;        // 4KB
const MARKDOWN_INLINE_MAX = 64 * 1024;   // 64KB
const FILE_MAX = 100 * 1024 * 1024;       // 100MB
const GC_RETENTION_DAYS = 30;
const DEFAULT_LOCAL_DIR = path.join(os.homedir(), '.evoclaw', 'artifacts');

export interface ArtifactServiceDeps {
  store: SqliteStore;
  /** 测试用，注入 mock registry */
  uriRegistry?: ArtifactURIRegistry;
  /** 本地文件根目录，默认 ~/.evoclaw/artifacts/{plan_id}/{task_id}/ */
  localBaseDir?: string;
}

export class ArtifactService {
  private store: SqliteStore;
  private uriRegistry: ArtifactURIRegistry;
  private localBaseDir: string;

  constructor(deps: ArtifactServiceDeps) {
    this.store = deps.store;
    this.uriRegistry = deps.uriRegistry ?? artifactURIRegistry;
    this.localBaseDir = deps.localBaseDir ?? DEFAULT_LOCAL_DIR;
  }

  // ─── attach ─────────────────────────────────────────────────

  /**
   * 创建 artifact
   *
   * 校验：
   *   - taskId 必须存在
   *   - kind 与 content/uri 组合合法（text/markdown 可 inline，其他必须有 uri）
   *   - inline 大小限制
   *   - 同 task + 同 title 自动 supersede 旧版（产生版本链）
   *   - createdByAgentId 应为当前 caller（仅做记录，不做 strict 校验，避免阻塞）
   */
  async attachArtifact(args: AttachArtifactArgs, callerAgentId: string): Promise<Artifact> {
    const taskRow = this.store.get<{ id: string; plan_id: string }>(
      `SELECT id, plan_id FROM tasks WHERE id = ?`,
      args.taskId,
    );
    if (!taskRow) throw new Error(`task 不存在: ${args.taskId}`);

    if (!args.title?.trim()) throw new Error('title 必填');
    if (!args.summary?.trim()) throw new Error('summary 必填（一行摘要）');

    const { content, uri, sizeBytes } = this.normalizeContentUri(
      args.kind,
      args.content,
      args.uri,
      args.sizeBytes,
    );

    // 同 task + 同 title 找最近一条非 supersede 的 → 设置版本链
    const prev = this.store.get<{ id: string }>(
      `SELECT id FROM task_artifacts
       WHERE task_id = ? AND title = ?
       ORDER BY created_at DESC LIMIT 1`,
      args.taskId,
      args.title,
    );

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const finalUri = uri ?? `evoclaw-artifact://${id}`;

    this.store.run(
      `INSERT INTO task_artifacts
       (id, task_id, plan_id, kind, title, uri, mime_type, size_bytes,
        inline_content, summary, created_by_agent_id, created_at, supersedes_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      args.taskId,
      taskRow.plan_id,
      args.kind,
      args.title,
      finalUri,
      args.mimeType ?? null,
      sizeBytes ?? null,
      content ?? null,
      args.summary,
      callerAgentId,
      now,
      prev?.id ?? null,
      args.metadata ? JSON.stringify(args.metadata) : null,
    );

    logger.info(
      `attachArtifact ok id=${id} task=${args.taskId} kind=${args.kind} title="${args.title.slice(0, 60)}" ` +
        `inline=${content !== undefined ? content.length : 0} uri=${finalUri.slice(0, 80)} supersedes=${prev?.id ?? 'none'}`,
    );

    return this.rowToArtifact(this.getRowOrThrow(id));
  }

  /**
   * 校验 + 规整 content/uri 组合
   *
   * - text/markdown：可二选一；优先 content（落 inline）；都没有就报错
   * - image/file/doc/link：必须有 uri；不允许 inline
   */
  private normalizeContentUri(
    kind: ArtifactKind,
    content: string | undefined,
    uri: string | undefined,
    sizeBytes: number | undefined,
  ): { content?: string; uri?: string; sizeBytes?: number } {
    const isInlineKind = kind === 'text' || kind === 'markdown';

    if (!isInlineKind) {
      if (!uri || !uri.trim()) {
        throw new Error(`kind=${kind} 必须提供 uri（不允许 inline content）`);
      }
      if (content !== undefined) {
        throw new Error(`kind=${kind} 不允许同时提供 content（请仅用 uri）`);
      }
      return { uri: uri.trim(), sizeBytes };
    }

    // text / markdown：可 inline 也可 uri
    if (content !== undefined) {
      const limit = kind === 'text' ? TEXT_INLINE_MAX : MARKDOWN_INLINE_MAX;
      if (content.length > limit) {
        throw new Error(
          `kind=${kind} inline content 超长 ${content.length}/${limit}，请改用 uri 或拆分`,
        );
      }
      return { content, sizeBytes: sizeBytes ?? Buffer.byteLength(content, 'utf-8') };
    }
    if (uri && uri.trim()) {
      return { uri: uri.trim(), sizeBytes };
    }
    throw new Error(`kind=${kind} 至少提供 content 或 uri 之一`);
  }

  // ─── list ───────────────────────────────────────────────────

  listByTask(taskId: string): Artifact[] {
    const rows = this.store.all<TaskArtifactRow>(
      `SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at DESC`,
      taskId,
    );
    return rows.map((r) => this.rowToArtifact(r));
  }

  listByPlan(planId: string): Artifact[] {
    const rows = this.store.all<TaskArtifactRow>(
      `SELECT * FROM task_artifacts WHERE plan_id = ? ORDER BY created_at DESC`,
      planId,
    );
    return rows.map((r) => this.rowToArtifact(r));
  }

  /**
   * 列出"最新版"（去掉被 supersede 的旧版）
   *
   * 策略：在结果集中，若某 row.id 出现在其他 row.supersedes_id，过滤掉
   */
  listLatestByTask(taskId: string): Artifact[] {
    const all = this.listByTask(taskId);
    const supersededIds = new Set<string>();
    for (const a of all) {
      if (a.supersedesId) supersededIds.add(a.supersedesId);
    }
    return all.filter((a) => !supersededIds.has(a.id));
  }

  getById(id: string): Artifact | null {
    const row = this.store.get<TaskArtifactRow>(`SELECT * FROM task_artifacts WHERE id = ?`, id);
    return row ? this.rowToArtifact(row) : null;
  }

  // ─── fetch ──────────────────────────────────────────────────

  /**
   * 取 artifact 内容
   *
   * mode='summary'（默认）：返回 artifact.summary 一行摘要，不读 URI
   * mode='full'：
   *   - 有 inline_content → 直接返回
   *   - URI 是 evoclaw-artifact://{id} → 取 inline，没有就 fallback
   *   - 其他 URI → uriRegistry.fetchUri 分发到渠道 resolver
   */
  async fetchArtifact(args: FetchArtifactArgs): Promise<FetchedArtifact | null> {
    const artifact = this.getById(args.artifactId);
    if (!artifact) {
      logger.warn(`fetchArtifact 找不到 id=${args.artifactId}`);
      return null;
    }
    const mode = args.mode ?? 'summary';
    if (mode === 'summary') {
      return {
        artifact,
        content: artifact.summary,
        fullLoaded: false,
        fallbackReason: 'summary-only',
      };
    }

    // mode = 'full'
    if (artifact.inlineContent) {
      logger.debug(`fetchArtifact full inline id=${args.artifactId} bytes=${artifact.inlineContent.length}`);
      return { artifact, content: artifact.inlineContent, fullLoaded: true };
    }

    // evoclaw-artifact:// 自己处理（兜底，本应已被 inline 路径覆盖）
    if (artifact.uri.startsWith('evoclaw-artifact://')) {
      logger.warn(`fetchArtifact evoclaw-artifact:// 但无 inline_content id=${args.artifactId}`);
      return {
        artifact,
        content: artifact.summary,
        fullLoaded: false,
        fallbackReason: 'no-inline-content',
      };
    }

    // file:// 直接读本地
    if (artifact.uri.startsWith('file://')) {
      const filePath = artifact.uri.slice('file://'.length);
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > FILE_MAX) {
          return {
            artifact,
            content: `[file too large: ${stat.size}B > ${FILE_MAX}B] path=${filePath}`,
            fullLoaded: false,
            fallbackReason: 'file-too-large',
          };
        }
        // 二进制文件不直接读，返回元信息
        const isText = guessIsText(artifact.mimeType, filePath);
        if (isText) {
          const content = fs.readFileSync(filePath, 'utf-8');
          logger.debug(`fetchArtifact file:// text loaded id=${args.artifactId} bytes=${stat.size}`);
          return { artifact, content, fullLoaded: true };
        }
        return {
          artifact,
          content: `[binary file] path=${filePath} size=${stat.size}B mime=${artifact.mimeType ?? 'unknown'}\n摘要：${artifact.summary}`,
          fullLoaded: false,
          fallbackReason: 'binary-file-not-loaded-as-text',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          artifact,
          content: `[file read error: ${msg}]`,
          fullLoaded: false,
          fallbackReason: `file-error: ${msg}`,
        };
      }
    }

    // 其他 URI 走 registry 分发（feishu-doc / feishu-image / feishu-file / 等）
    const result = await this.uriRegistry.fetchUri(artifact.uri);
    return {
      artifact,
      content: result.content,
      fullLoaded: result.fullLoaded,
      fallbackReason: result.fallbackReason,
    };
  }

  // ─── GC ────────────────────────────────────────────────────

  /**
   * 清理 plan completed 超过 N 天的本地文件缓存（仅清 file:// 在 localBaseDir 下的文件）
   *
   * @returns 清理的文件数
   */
  gcOldArtifacts(retentionDays = GC_RETENTION_DAYS): number {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.store.all<TaskArtifactRow>(
      `SELECT a.* FROM task_artifacts a
       JOIN task_plans p ON p.id = a.plan_id
       WHERE p.status = 'completed' AND p.completed_at IS NOT NULL AND p.completed_at < ?
         AND a.uri LIKE 'file://%'`,
      cutoff,
    );
    let removed = 0;
    for (const row of rows) {
      const filePath = row.uri.slice('file://'.length);
      // 仅清 localBaseDir 下的文件，不动外部路径
      if (!filePath.startsWith(this.localBaseDir)) continue;
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch (err) {
        logger.warn(`gc 删除 ${filePath} 失败`, err);
      }
    }
    if (removed > 0) {
      logger.info(`gc 完成：清理 ${removed} 个本地文件（plan completed > ${retentionDays} 天）`);
    }
    return removed;
  }

  // ─── 内部 ───────────────────────────────────────────────────

  private getRowOrThrow(id: string): TaskArtifactRow {
    const row = this.store.get<TaskArtifactRow>(`SELECT * FROM task_artifacts WHERE id = ?`, id);
    if (!row) throw new Error(`artifact 创建后查询失败: ${id}（不应发生）`);
    return row;
  }

  private rowToArtifact(row: TaskArtifactRow): Artifact {
    let metadata: Record<string, unknown> | undefined;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        logger.warn(`artifact ${row.id} metadata JSON 解析失败`);
      }
    }
    return {
      id: row.id,
      taskId: row.task_id,
      planId: row.plan_id,
      kind: row.kind,
      title: row.title,
      uri: row.uri,
      mimeType: row.mime_type ?? undefined,
      sizeBytes: row.size_bytes ?? undefined,
      inlineContent: row.inline_content ?? undefined,
      summary: row.summary,
      createdByAgentId: row.created_by_agent_id,
      createdAt: row.created_at,
      supersedesId: row.supersedes_id ?? undefined,
      metadata,
    };
  }
}

function guessIsText(mimeType: string | undefined, filePath: string): boolean {
  if (mimeType) {
    if (mimeType.startsWith('text/')) return true;
    if (mimeType === 'application/json' || mimeType === 'application/xml') return true;
    if (mimeType === 'application/javascript' || mimeType === 'application/typescript') return true;
  }
  // fallback：按扩展名
  const ext = path.extname(filePath).toLowerCase();
  return ['.txt', '.md', '.json', '.yaml', '.yml', '.csv', '.log', '.html', '.xml', '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.sql'].includes(ext);
}
