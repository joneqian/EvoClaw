import type { SessionKey } from '@evoclaw/shared';
import {
  isSubAgentSessionKey,
  isCronSessionKey,
  isHeartbeatSessionKey,
} from '../routing/session-key.js';

/**
 * Workspace 文件策略 — DRY 化原 chat.ts/channel-message-handler.ts 中的文件清单 +
 * 提供 fail-closed 门控判定（subagent/cron 不可访问 BOOTSTRAP/HEARTBEAT/MEMORY 根文件）
 *
 * 参考 OpenClaw `MINIMAL_BOOTSTRAP_ALLOWLIST` (src/agents/workspace.ts:669-685)，
 * 但 EvoClaw 在 prompt 注入和 LLM tool 两层都做了门控（OpenClaw 仅 prompt 层）。
 *
 * 历史 drift（修复掉）：
 * - chat.ts ALL 含 TODO.json，channel-message-handler.ts 没有
 * - chat.ts HEARTBEAT 含 AGENTS.md，channel-message-handler.ts 没有
 */

/** 工作区文件清单常量 */
export const WORKSPACE_FILE_LISTS = {
  /** 主 session 完整加载（含 TODO.json） */
  ALL: [
    'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md',
    'USER.md', 'MEMORY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'TODO.json',
  ] as const,

  /** subagent / cron 受限清单（共享 5 文件） */
  MINIMAL: ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'USER.md'] as const,

  /** 心跳轮询：清单 + 操作规程（避免 Agent 在心跳里答非所问） */
  HEARTBEAT: ['HEARTBEAT.md', 'AGENTS.md'] as const,

  /** 极简心跳（lightContext=true）：仅清单本身 */
  LIGHT: ['HEARTBEAT.md'] as const,
} as const;

/**
 * subagent / cron 不允许读写的根目录文件
 *
 * - BOOTSTRAP.md：主 Agent onboarding 流，子 Agent 不该篡改 setup_completed 状态
 * - HEARTBEAT.md：主 Agent 周期清单，子 Agent 不该改影响主 session
 * - MEMORY.md：DB 渲染视图（每轮重建），子 Agent 写也会被覆盖（防误导）
 *
 * 仅匹配 workspace **根目录** 同名文件；子目录同名文件不限制。
 */
export const RESTRICTED_FILES_FOR_SUBAGENT: ReadonlySet<string> = new Set([
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'MEMORY.md',
]);

/** selectWorkspaceFiles 选项 */
export interface SelectWorkspaceFilesOpts {
  /** 心跳信号（chat.ts body.isHeartbeat / sessionKey 含 :heartbeat:） */
  isHeartbeat?: boolean;
  /** 极简心跳（chat.ts body.lightContext） */
  isLightContext?: boolean;
}

/**
 * 选择本次请求要加载的工作区文件清单
 *
 * 优先级（高到低）：
 *   1. lightContext=true → LIGHT（仅 HEARTBEAT.md）
 *   2. isHeartbeat=true 或 sessionKey 含 :heartbeat: → HEARTBEAT
 *   3. subagent / cron sessionKey → MINIMAL
 *   4. 其他 → ALL
 */
export function selectWorkspaceFiles(
  sessionKey: SessionKey | string | undefined,
  opts: SelectWorkspaceFilesOpts,
): readonly string[] {
  if (opts.isLightContext) return WORKSPACE_FILE_LISTS.LIGHT;
  if (opts.isHeartbeat || (sessionKey && isHeartbeatSessionKey(sessionKey))) return WORKSPACE_FILE_LISTS.HEARTBEAT;
  if (sessionKey && (isSubAgentSessionKey(sessionKey) || isCronSessionKey(sessionKey))) return WORKSPACE_FILE_LISTS.MINIMAL;
  return WORKSPACE_FILE_LISTS.ALL;
}

/**
 * 判定 sessionKey 是否允许访问指定 workspace 文件
 *
 * - sessionKey 缺失 → 通过（内部 / 管理员调用，无 sessionKey 概念）
 * - 文件名不在 RESTRICTED 集合 → 通过
 * - sessionKey 是 subagent / cron 且文件在 RESTRICTED → 拒绝
 * - 其他 sessionKey（含 heartbeat 主 session）→ 通过
 *
 * 注意：仅匹配根目录文件名，`sub/BOOTSTRAP.md` 不算受限。
 */
export function isWorkspaceFileAccessAllowed(
  sessionKey: SessionKey | string | undefined,
  file: string,
): boolean {
  if (!sessionKey) return true;
  // 仅根目录受限：file 含 / 或 \ 视为子目录
  if (file.includes('/') || file.includes('\\')) return true;
  if (!RESTRICTED_FILES_FOR_SUBAGENT.has(file)) return true;
  return !(isSubAgentSessionKey(sessionKey) || isCronSessionKey(sessionKey));
}
