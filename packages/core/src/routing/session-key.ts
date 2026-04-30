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
 * 是否为受限会话（subagent 或 cron）
 *
 * 受限会话访问 workspace RESTRICTED 文件（BOOTSTRAP/HEARTBEAT/MEMORY 根文件）会被 fail-closed 拒绝。
 * 注意：heartbeat 不算受限——它仍是主 session 的延伸，需要读 HEARTBEAT.md 才能干活。
 */
export function isPrivilegedSessionKey(key: SessionKey | string): boolean {
  return !isSubAgentSessionKey(key) && !isCronSessionKey(key);
}
