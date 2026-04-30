import type { AgentManager } from './agent-manager.js';
import { SOUL_BASE, generateIdentityMd } from './agent-manager.js';

/**
 * BOOTSTRAP reconcile 自愈
 *
 * 替代 chat.ts / channel-message-handler.ts 中"history.length >= 12 强清"硬编码兜底，
 * 改用基于"用户行为证据"的状态机自愈。参考 OpenClaw 的
 * reconcileWorkspaceBootstrapCompletionState 思路。
 *
 * 触发场景：
 *   1. 每次发消息前（chat.ts / channel-message-handler.ts）
 *   2. sidecar 启动后扫所有 active agents 一次（server.ts）
 *
 * 完成判定（任一为真即视为 setup 完成）：
 *   - BOOTSTRAP.md 不存在 / trim().length === 0（Agent 主动清空）
 *   - USER.md 非空（初始模板写入空字符串，非空即被编辑）
 *   - SOUL.md 与 SOUL_BASE 不同
 *   - IDENTITY.md 与初始 generateIdentityMd(agent) 不同
 *   - historyLength >= 30（远高于原 12 轮，仅作 safety net 兜底）
 */

const HISTORY_FALLBACK_THRESHOLD = 30;

export type ReconcileReason =
  | 'already_completed'
  | 'bootstrap_cleared'
  | 'profile_configured'
  | 'legacy_migration'
  | 'history_fallback'
  | 'no_evidence';

export interface ReconcileResult {
  /** 是否在本次调用中执行了状态变更（写 setup_completed_at / 清空 BOOTSTRAP.md） */
  repaired: boolean;
  /** 当前 setup 状态（无论是否本次 repair） */
  setupCompleted: boolean;
  /** 决策原因 */
  reason: ReconcileReason;
}

export interface ReconcileParams {
  agentId: string;
  agentManager: AgentManager;
  /** 当前会话历史长度（main session）；用于 30 轮 safety net */
  historyLength?: number;
}

/**
 * 执行 BOOTSTRAP 状态自愈
 *
 * 同步实现（基于 AgentManager 同步 API + better-sqlite3 同步驱动），
 * 调用方可在 hot path 直接 call，无需 await。
 */
export function reconcileBootstrapState(params: ReconcileParams): ReconcileResult {
  const { agentId, agentManager, historyLength } = params;

  // Fast path 1: 已完成 → 幂等返回
  if (agentManager.isSetupCompleted(agentId)) {
    return { repaired: false, setupCompleted: true, reason: 'already_completed' };
  }

  // 收集证据
  const evidence = collectProfileEvidence(agentId, agentManager);
  const bootstrapSeeded = agentManager.getWorkspaceState(agentId, 'bootstrap_seeded_at');

  // 老 workspace 自愈：缺 bootstrap_seeded_at + 已配置 → 同时回填两个时间戳
  if (!bootstrapSeeded) {
    if (evidence.profileConfigured) {
      const now = new Date().toISOString();
      agentManager.setWorkspaceState(agentId, 'bootstrap_seeded_at', now);
      agentManager.setWorkspaceState(agentId, 'setup_completed_at', now);
      clearBootstrapFile(agentId, agentManager);
      return { repaired: true, setupCompleted: true, reason: 'legacy_migration' };
    }
    // 老 workspace 但未配置：留给常规 initWorkspace 逻辑处理
    return { repaired: false, setupCompleted: false, reason: 'no_evidence' };
  }

  // 正常路径 1：BOOTSTRAP.md 已被清空 / 删除（Agent 显式信号）
  if (evidence.bootstrapEmpty) {
    markCompleted(agentId, agentManager, 'bootstrap_cleared');
    return { repaired: true, setupCompleted: true, reason: 'bootstrap_cleared' };
  }

  // 正常路径 2：profile 文件被编辑（用户行为证据）
  if (evidence.profileConfigured) {
    markCompleted(agentId, agentManager, 'profile_configured');
    clearBootstrapFile(agentId, agentManager);
    return { repaired: true, setupCompleted: true, reason: 'profile_configured' };
  }

  // 兜底路径：30 轮以上仍无信号 → safety net
  if (typeof historyLength === 'number' && historyLength >= HISTORY_FALLBACK_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bootstrap-reconciler] agent=${agentId} history=${historyLength} ` +
        `force-clearing BOOTSTRAP.md after ${HISTORY_FALLBACK_THRESHOLD}-turn safety net (no profile evidence found)`,
    );
    markCompleted(agentId, agentManager, 'history_fallback');
    clearBootstrapFile(agentId, agentManager);
    return { repaired: true, setupCompleted: true, reason: 'history_fallback' };
  }

  return { repaired: false, setupCompleted: false, reason: 'no_evidence' };
}

interface ProfileEvidence {
  bootstrapEmpty: boolean;
  profileConfigured: boolean;
}

function collectProfileEvidence(agentId: string, agentManager: AgentManager): ProfileEvidence {
  const bootstrapContent = agentManager.readWorkspaceFile(agentId, 'BOOTSTRAP.md');
  const bootstrapEmpty = !bootstrapContent || bootstrapContent.trim().length === 0;

  if (bootstrapEmpty) {
    // BOOTSTRAP 已清/缺 时跳过其余比对（节省 IO）
    return { bootstrapEmpty: true, profileConfigured: false };
  }

  // USER.md 初始为空字符串（agent-manager.ts:230），非空即被编辑
  const userMd = agentManager.readWorkspaceFile(agentId, 'USER.md');
  if (userMd && userMd.trim().length > 0) {
    return { bootstrapEmpty: false, profileConfigured: true };
  }

  // SOUL.md 是静态模板（无 config 注入），直接字符串比对
  const soulMd = agentManager.readWorkspaceFile(agentId, 'SOUL.md');
  if (soulMd !== undefined && soulMd !== SOUL_BASE) {
    return { bootstrapEmpty: false, profileConfigured: true };
  }

  // IDENTITY.md 含 config.name/emoji，需根据当前 agent 重算 template
  const identityMd = agentManager.readWorkspaceFile(agentId, 'IDENTITY.md');
  if (identityMd !== undefined) {
    const agent = agentManager.getAgent(agentId);
    if (agent) {
      const expectedIdentity = generateIdentityMd(agent);
      if (identityMd !== expectedIdentity) {
        return { bootstrapEmpty: false, profileConfigured: true };
      }
    }
  }

  return { bootstrapEmpty: false, profileConfigured: false };
}

function markCompleted(agentId: string, agentManager: AgentManager, reason: ReconcileReason): void {
  agentManager.setWorkspaceState(agentId, 'setup_completed_at', new Date().toISOString());
  // 调试用：记录决策原因，便于事后排查 false-positive 误清
  agentManager.setWorkspaceState(agentId, 'setup_completed_reason', reason);
}

function clearBootstrapFile(agentId: string, agentManager: AgentManager): void {
  const current = agentManager.readWorkspaceFile(agentId, 'BOOTSTRAP.md');
  if (current && current.trim().length > 0) {
    agentManager.writeWorkspaceFile(agentId, 'BOOTSTRAP.md', '');
  }
}
