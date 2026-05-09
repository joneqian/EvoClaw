import type { SessionKey } from '@evoclaw/shared';

/**
 * M13 Phase 1 PR-1A: DM 跨渠道连贯
 *
 * dmScope 决定 DM (chatType='direct') 场景下 sessionKey 的隔离粒度：
 *   - 'main'                       → agent:{id}:main
 *     全局视角，跨渠道跨 peer 共享。员工"飞书 DM lead 又在企微 DM lead"想要连贯时用此默认值
 *   - 'per-peer'                   → agent:{id}:direct:{peer}
 *     每对话独立（不区分 channel/account）— 多渠道同 peerId 时合并
 *   - 'per-channel-peer'           → agent:{id}:{ch}:direct:{peer}
 *     每渠道每对话独立（PR-1A 之前 EvoClaw 行为）
 *   - 'per-account-channel-peer'   → agent:{id}:{ch}:{acc}:direct:{peer}
 *     最细粒度（账号+渠道+对话）
 *
 * 群聊（chatType='group'）不受 dmScope 影响，固定 `agent:{id}:{ch}:{kind}:{peer}` 格式。
 *
 * D3 用户决策（2026-05-09）：DM 默认 dmScope='main'（跨渠道连贯），员工可在 BindingsPage
 * 改 'per-peer' 显式隔离。NULL 在 binding 中表示未配置，channel-message-handler 用全局默认。
 */
export type DmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';

/** generateSessionKey 默认 DmScope（D3：DM 默认跨渠道连贯） */
export const DEFAULT_DM_SCOPE: DmScope = 'main';

/**
 * M13 Phase 1 PR-1B: identityLinks lookup 接口
 *
 * 解耦 generateSessionKey 与 IdentityLinksStore — store 实例化在 server 层，
 * generateSessionKey 通过此接口注入。`(channel, peerId) → canonicalId | null`。
 *
 * 命中时 generateSessionKey 把 peerId 替换为 canonicalId，让跨渠道同员工
 * sessionKey 合并（'agent:X:feishu:direct:ou_xxx' 和 'agent:X:wecom:direct:userid_yyy'
 * 都合并到 'agent:X:direct:self'）。
 */
export type IdentityLinkLookup = (channel: string, peerId: string) => string | null;

/** 解析后的 Session 信息 */
export interface ParsedSession {
  agentId: string;
  channel: string;
  chatType: string;   // 'direct' | 'group' | 'main'（PR-1A 加 'main'）
  peerId: string;
}

/** 生成 Session Key — 旧位置参数签名向后兼容 */
export function generateSessionKey(
  agentId: string,
  channel: string = 'default',
  chatType: string = 'direct',
  peerId: string = '',
  /**
   * M13 Phase 1 PR-1A: dmScope / accountId 可选；仅 chatType='direct' 时生效。
   * PR-1B: identityLookup 可选；命中时把 peerId 替换为 canonicalId 让跨渠道
   * 同员工 sessionKey 合并。
   * 不传时回退到 'per-channel-peer'（PR-1A 之前的等价行为，保旧调用兼容）。
   */
  options?: { dmScope?: DmScope; accountId?: string; identityLookup?: IdentityLinkLookup },
): SessionKey {
  // 群聊 / 非 direct 不受 dmScope 影响
  if (chatType !== 'direct') {
    return `agent:${agentId}:${channel}:${chatType}:${peerId}` as SessionKey;
  }

  // PR-1B: identityLinks 命中时把 peerId 替换为 canonicalId
  let effectivePeerId = peerId;
  if (options?.identityLookup && peerId) {
    const canonical = options.identityLookup(channel, peerId);
    if (canonical) {
      effectivePeerId = canonical;
    }
  }

  // DM：按 dmScope 分支
  const dmScope: DmScope = options?.dmScope ?? 'per-channel-peer';
  switch (dmScope) {
    case 'main':
      return generateMainSessionKey(agentId);
    case 'per-peer':
      return `agent:${agentId}:direct:${effectivePeerId}` as SessionKey;
    case 'per-account-channel-peer': {
      const acc = options?.accountId ?? '';
      return `agent:${agentId}:${channel}:${acc}:direct:${effectivePeerId}` as SessionKey;
    }
    case 'per-channel-peer':
    default:
      return `agent:${agentId}:${channel}:direct:${effectivePeerId}` as SessionKey;
  }
}

/**
 * M13 Phase 1 PR-1A: 生成 mainSessionKey（Agent 全局视角会话）
 *
 * 格式：agent:{agentId}:main
 *
 * 用法：当 binding.dmScope='main'（默认）时，DM 消息走此 key，跨渠道跨 peer 共享上下文。
 * 与 'agent:X:feishu:direct:ou_xxx' 等 per-peer key 完全不同的命名空间。
 */
export function generateMainSessionKey(agentId: string): SessionKey {
  return `agent:${agentId}:main` as SessionKey;
}

/**
 * M13 Phase 1 PR-1A: 判断是否为 main session
 *
 * main 格式严格 3 段（agent:id:main），与多段 sessionKey 区分。
 */
export function isMainSessionKey(key: SessionKey | string): boolean {
  const parts = key.split(':');
  return parts.length === 3 && parts[0] === 'agent' && parts[2] === 'main';
}

/** 解析 Session Key */
export function parseSessionKey(key: SessionKey | string): ParsedSession {
  const parts = key.split(':');
  // M13 Phase 1: main session 特殊处理（agent:X:main 3 段）
  if (parts.length === 3 && parts[2] === 'main') {
    return {
      agentId: parts[1] ?? '',
      channel: 'main',
      chatType: 'main',
      peerId: '',
    };
  }
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
 * 判断是否为 Skill Curator session（受限会话）
 *
 * marker 来源：skill-curator.ts 起跨 session 治理 sub-agent 时用
 * `agent:curator:local:curator:<runId>` 格式。
 *
 * Curator 是独立于 background-review 的"跨 session"治理（每 7 天一次，识别
 * 多 skill 重叠并合并 umbrella），跟 background-review 单 session 学习互斥。
 */
export function isCuratorSessionKey(key: SessionKey | string): boolean {
  return key.includes(':curator:');
}

/**
 * 是否为受限会话（subagent / cron / background-review / curator）
 *
 * 受限会话访问 workspace RESTRICTED 文件（BOOTSTRAP/HEARTBEAT/MEMORY 根文件）会被 fail-closed 拒绝。
 * 注意：heartbeat 不算受限——它仍是主 session 的延伸，需要读 HEARTBEAT.md 才能干活。
 */
export function isPrivilegedSessionKey(key: SessionKey | string): boolean {
  return !isSubAgentSessionKey(key)
    && !isCronSessionKey(key)
    && !isBackgroundReviewSessionKey(key)
    && !isCuratorSessionKey(key);
}

/** 生成 Curator 用的 sessionKey（含 marker，跨 session 治理触发） */
export function generateCuratorSessionKey(): SessionKey {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `agent:curator:local:curator:${ts}-${rand}` as SessionKey;
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
