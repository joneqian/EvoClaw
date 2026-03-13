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
