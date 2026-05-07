import type { SessionKey } from '@evoclaw/shared';

/** 解析后的 Session 信息 */
export interface ParsedSession {
  agentId: string;
  channel: string;
  chatType: string;   // 'direct' | 'group'
  peerId: string;
}

/** 生成 Session Key */
export function generateSessionKey(
  agentId: string,
  channel: string = 'default',
  chatType: string = 'direct',
  peerId: string = '',
): SessionKey {
  return `agent:${agentId}:${channel}:${chatType}:${peerId}` as SessionKey;
}

/** 解析 Session Key */
export function parseSessionKey(key: SessionKey | string): ParsedSession {
  const parts = key.split(':');
  return {
    agentId: parts[1] ?? '',
    channel: parts[2] ?? 'default',
    chatType: parts[3] ?? 'direct',
    peerId: parts[4] ?? '',
  };
}

/** 判断是否为群聊 */
export function isGroupChat(key: SessionKey | string): boolean {
  return parseSessionKey(key).chatType === 'group';
}

/** 判断是否为私聊 */
export function isDirectChat(key: SessionKey | string): boolean {
  return parseSessionKey(key).chatType === 'direct';
}

/**
 * 判断是否为子 Agent session（受限会话）
 * marker 来源：sub-agent-spawner.ts 的 `agent:<id>:local:subagent:<taskId>` 格式
 */
export function isSubAgentSessionKey(key: SessionKey | string): boolean {
  return key.includes(':subagent:');
}

/**
 * 判断是否为 Cron 任务 session（受限会话）
 * marker 来源：cron-runner.ts 的 `agent:<id>:cron:<jobId>` 格式
 */
export function isCronSessionKey(key: SessionKey | string): boolean {
  return key.includes(':cron:');
}

/**
 * 判断是否为心跳轮询 session（仍属主 session 范畴）
 * marker 来源：heartbeat-runner / channel-message-handler 的 `:heartbeat:` 内嵌
 */
export function isHeartbeatSessionKey(key: SessionKey | string): boolean {
  return key.includes(':heartbeat:');
}

/**
 * 判断是否为 Background Skill Review session（受限会话）
 *
 * marker 来源：skill-background-review-runner.ts 起 sub-agent 时用
 * `agent:<id>:local:background-review:<turnId>` 格式。
 *
 * Background review 是 fire-and-forget 的 sub-agent fork，每 N=10 turn 触发一次，
 * 让 LLM 看完整对话历史 + 已用 skill，自主决策是否 patch SKILL.md
 * （灵感来自 Hermes _spawn_background_review）。
 */
export function isBackgroundReviewSessionKey(key: SessionKey | string): boolean {
  return key.includes(':background-review:');
}

/**
 * 是否为受限会话（subagent / cron / background-review）
 *
 * 受限会话访问 workspace RESTRICTED 文件（BOOTSTRAP/HEARTBEAT/MEMORY 根文件）会被 fail-closed 拒绝。
 * 注意：heartbeat 不算受限——它仍是主 session 的延伸，需要读 HEARTBEAT.md 才能干活。
 */
export function isPrivilegedSessionKey(key: SessionKey | string): boolean {
  return !isSubAgentSessionKey(key)
    && !isCronSessionKey(key)
    && !isBackgroundReviewSessionKey(key);
}

/** 生成 Background Review 用的 sessionKey（含 marker，禁递归） */
export function generateBackgroundReviewSessionKey(
  agentId: string,
  parentSessionKey: SessionKey | string,
): SessionKey {
  // 用 parent sessionKey 的简短哈希避免冲突，且便于排障对应原 session
  const parentHash = simpleHash(String(parentSessionKey)).toString(36).slice(0, 8);
  const ts = Date.now().toString(36);
  return `agent:${agentId}:local:background-review:${parentHash}-${ts}` as SessionKey;
}

/** 极简哈希（FNV-1a），不用 crypto 避免边缘场景慢启动 */
function simpleHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
