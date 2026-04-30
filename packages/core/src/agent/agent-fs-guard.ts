/**
 * Agent 工作区写入边界守卫
 *
 * 用途：兜底拦截 LLM 在 builtin write/edit / bash 工具里把 agent UUID 写错的情况
 *（典型 hallucinate：b↔d 互换、6↔9 互换），避免 fs.mkdirSync(recursive:true) 默默
 * 创建"影子工作区"目录污染数据卫生。
 *
 * 拦截范围（FAIL-CLOSED in agent dir）：
 * - 路径**不在** agentsBaseDir 下 → 透传（不归本 guard 管，由各工具自身的黑名单/Layer 1 边界）
 * - 路径**在** agentsBaseDir 下，且第一段是 agents 表已知 id → 通过
 * - 路径**在** agentsBaseDir 下，但第一段 id 在 agents 表中找不到 → 拒绝并附自纠 hint
 * - 例外：`agentsBaseDir/_orphan/...` 与 `agentsBaseDir/by-name/...` 透传（管理目录）
 *
 * 性能：50ms TTL 微缓存避免每次 write 都打 DB；缓存 miss 走单条 SELECT。
 */

import path from 'node:path';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { isSubAgentSessionKey, isCronSessionKey } from '../routing/session-key.js';
import { RESTRICTED_FILES_FOR_SUBAGENT } from './workspace-files-policy.js';

/** 校验通过 */
export interface FsGuardOk {
  readonly ok: true;
}

/** 校验拒绝（含给 LLM 自纠的明确提示） */
export interface FsGuardReject {
  readonly ok: false;
  readonly reason: string;
  readonly hint: string;
  /** 命中拒绝时抽到的 UUID（用于审计） */
  readonly uuid: string;
}

export type FsGuardResult = FsGuardOk | FsGuardReject;

/** 缓存 TTL（毫秒）—— 50ms 足够吸收同一 turn 的密集写入，又不至于让 createAgent 之后立即写入失败 */
const CACHE_TTL_MS = 50;

/** 不参与"agent_id"校验的管理目录 */
const RESERVED_DIRS = new Set(['_orphan', 'by-name']);

/**
 * 工作区写入边界守卫
 *
 * 单例使用：每个 sidecar 进程、每个 agent runner 共用一份；线程不安全（Node 单线程 OK）。
 */
export class AgentFsGuard {
  private readonly resolvedBase: string;
  private readonly cache: Map<string, { exists: boolean; expireAt: number }> = new Map();

  constructor(
    private readonly store: SqliteStore,
    agentsBaseDir: string,
  ) {
    this.resolvedBase = path.resolve(agentsBaseDir);
  }

  /**
   * 校验写入路径合法性
   *
   * @param absPath 绝对路径（路径展开 / `~/` 替换由调用方负责）
   * @returns ok 或带 reason/hint 的 reject
   */
  validateWritePath(absPath: string): FsGuardResult {
    const resolved = path.resolve(absPath);

    // 不在 agentsBaseDir 下 → guard 不管
    if (!isInside(resolved, this.resolvedBase)) {
      return { ok: true };
    }

    // 抽出 agentsBaseDir 下的第一段
    const rel = path.relative(this.resolvedBase, resolved);
    const firstSeg = rel.split(path.sep)[0] ?? '';
    if (!firstSeg) {
      // 直接写在 agentsBaseDir 根目录下（罕见），放过
      return { ok: true };
    }

    // 管理目录例外
    if (RESERVED_DIRS.has(firstSeg)) {
      return { ok: true };
    }

    // 检查 uuid 是否在 agents 表中
    if (this.agentExists(firstSeg)) {
      return { ok: true };
    }

    return {
      ok: false,
      uuid: firstSeg,
      reason: `路径 ${resolved} 中的 agent_id "${firstSeg}" 不在 agents 表中。`,
      hint: [
        '你可能拼错了 UUID（这是 LLM 在长十六进制串上常见的 hallucination）。',
        '改用相对路径：例如 file_path="foo.md" 或 file_path="@workspace/foo.md"，',
        '系统会自动定位到当前 agent 的 workspace。',
        '如果一定要用绝对路径，请确认 agent_id 与 system prompt 中 runtime 段标注的 Agent ID 完全一致（一字不差）。',
      ].join('\n'),
    };
  }

  /** 仅供测试：清空缓存 */
  clearCache(): void {
    this.cache.clear();
  }

  /** 50ms TTL 微缓存 + 单条 SELECT */
  private agentExists(id: string): boolean {
    const now = Date.now();
    const cached = this.cache.get(id);
    if (cached && cached.expireAt > now) {
      return cached.exists;
    }

    let exists = false;
    try {
      const row = this.store.get<{ id: string }>(
        'SELECT id FROM agents WHERE id = ? LIMIT 1',
        id,
      );
      exists = row !== undefined;
    } catch {
      // DB 不可用时 fail-open（不阻塞用户）；fail-closed 风险更高（无法启动 agent）
      exists = true;
    }

    this.cache.set(id, { exists, expireAt: now + CACHE_TTL_MS });
    return exists;
  }
}

/** 检查 child 是否落在 parent 之下（含 parent 自身） */
function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const childWithSep = child.endsWith(path.sep) ? child : child + path.sep;
  const parentWithSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return childWithSep.startsWith(parentWithSep);
}

// ───────────────────────────────────────────────────────────────────────────
// Bash 命令路径扫描（用于 bash wrapper 在 spawn 前拦截）
// ───────────────────────────────────────────────────────────────────────────

/** 从 bash 命令字符串里抽取所有"看起来是 EvoClaw agent workspace"的路径片段 */
const BASH_AGENT_PATH_RE =
  /(?:~\/|\/Users\/[^/\s'"]+\/|\$HOME\/)\.[A-Za-z0-9_-]+\/agents\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\b/g;

/**
 * 从 bash 命令里抽出形如 `~/.{brand}/agents/<uuid>/...` 的路径，逐一交给 guard 校验。
 * 返回首个被拒绝的结果；全部通过则返回 ok。
 */
export function inspectBashCommand(
  command: string,
  guard: AgentFsGuard,
  agentsBaseDir: string,
): FsGuardResult {
  if (!command || command.indexOf('/agents/') < 0) {
    return { ok: true };
  }

  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  BASH_AGENT_PATH_RE.lastIndex = 0;
  while ((match = BASH_AGENT_PATH_RE.exec(command)) !== null) {
    const uuid = match[1];
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    // 拼一条规范化绝对路径交给 guard
    const probe = path.join(agentsBaseDir, uuid, '__probe__');
    const result = guard.validateWritePath(probe);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────
// P1-A 跟尾：bash 命令访问 workspace RESTRICTED 文件门控
// ───────────────────────────────────────────────────────────────────────────

/**
 * 把 bash 命令拆成"路径候选 token"
 *
 * 拆分逻辑：
 * - 按空白 / shell 分隔符（; | & < > ()）切
 * - 剥两端引号（' "）
 * - 空 token 跳过
 *
 * 不做完整 bash AST 解析（成本高、收益边际），用宽松的 token 化扫描足以覆盖
 * 90% 攻击模式（cat / head / grep / echo > / |、& 复合命令）。
 */
function tokenizeBashCommand(command: string): string[] {
  return command
    .split(/[\s;|&<>()]+/)
    .map(t => t.replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);
}

/**
 * 判断单个 token 是否引用 workspace 根目录的 RESTRICTED 文件
 *
 * 命中规则：
 *   1. token 等于 RESTRICTED 文件名本身（'BOOTSTRAP.md'）
 *   2. token === './<RESTRICTED>'
 *   3. token 是绝对路径，目录恰好是 workspaceRoot 且文件名 ∈ RESTRICTED
 *
 * 不命中（放行）：
 *   - 子目录同名（'sub/BOOTSTRAP.md'）
 *   - 文件名是 RESTRICTED 子串（'MYBOOTSTRAP.md' / 'HEARTBEAT.md.bak'）
 */
function tokenReferencesRestrictedRootFile(token: string, workspaceRoot: string): string | null {
  // 1. 直接文件名 / ./ 前缀
  for (const restricted of RESTRICTED_FILES_FOR_SUBAGENT) {
    if (token === restricted) return restricted;
    if (token === `./${restricted}`) return restricted;
  }
  // 2. 绝对路径，dirname 恰好是 workspaceRoot
  if (path.isAbsolute(token)) {
    const wsRootResolved = path.resolve(workspaceRoot);
    const tokenResolved = path.resolve(token);
    if (path.dirname(tokenResolved) === wsRootResolved) {
      const basename = path.basename(tokenResolved);
      if (RESTRICTED_FILES_FOR_SUBAGENT.has(basename)) return basename;
    }
  }
  return null;
}

/**
 * 检查 bash 命令是否在 subagent / cron 上下文里试访问 workspace RESTRICTED 文件
 *
 * 约束：
 * - sessionKey / workspaceRoot 任一缺失 → 跳过门控（旧调用方 / 内部）
 * - sessionKey 不是 subagent / cron → 跳过（heartbeat / 主 session 仍可读 HEARTBEAT.md）
 * - 命中：返回 FsGuardReject，给 LLM 友好自纠提示
 *
 * 不在范围（已知绕开缺口）：
 * - 通过 \$WORKSPACE_PATH 等 shell 变量动态拼路径
 * - 通过 base64/eval 间接构造路径
 * - 通过 cd workspace_root && cat BOOTSTRAP.md（cd 后相对路径会命中规则 1）
 */
export function inspectBashRestrictedFiles(
  command: string,
  sessionKey: string | undefined,
  workspaceRoot: string | undefined,
): FsGuardResult {
  if (!command || !sessionKey || !workspaceRoot) return { ok: true };
  if (!isSubAgentSessionKey(sessionKey) && !isCronSessionKey(sessionKey)) return { ok: true };

  const tokens = tokenizeBashCommand(command);
  for (const token of tokens) {
    const hit = tokenReferencesRestrictedRootFile(token, workspaceRoot);
    if (hit) {
      return {
        ok: false,
        uuid: '',
        reason: `受限会话（subagent / cron）不能用 bash 访问 workspace 根目录的 ${hit}`,
        hint:
          `这是主 Agent 的 ${hit === 'BOOTSTRAP.md' ? 'onboarding' : hit === 'HEARTBEAT.md' ? '周期清单' : '记忆视图'}，` +
          `子 Agent / Cron 任务读写都会破坏主会话状态。\n` +
          `如需共享信息，请用 memory_search / memory_write 工具，或者把内容放到 workspace 子目录。`,
      };
    }
  }

  return { ok: true };
}
