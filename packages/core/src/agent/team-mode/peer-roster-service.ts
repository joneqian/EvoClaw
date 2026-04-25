/**
 * Peer Roster Service —— Layer 2 团队发现服务（M13 多 Agent 团队协作）
 *
 * 核心算法：团队 = "渠道群成员 API" × "本地 bindings 表" 取交集，
 *           Agent 通过 system prompt 里的 <team_roster> XML 块知道同事是谁。
 *
 * 6 步流水线（buildRoster）：
 *   1. 查缓存（5 min TTL per (agentId, groupSessionKey)）
 *   2. teamChannelRegistry.resolve(groupSessionKey) → adapter
 *   3. adapter.listPeerBots(...) → PeerBotIdentity[]
 *   4. 对每个 peer.agentId 查 AgentManager 补齐 name/emoji/role
 *   5. 过滤 status !== 'active' 的 peer（草稿 / 归档不暴露）
 *   6. 落缓存返回
 *
 * 失效机制：
 *   - 5 min TTL 兜底
 *   - 渠道事件驱动（teamChannelRegistry.onMembershipChanged）
 *   - 手动 invalidate（BindingRouter 增删时调）
 */

import type { AgentManager } from '../agent-manager.js';
import { createLogger } from '../../infrastructure/logger.js';
import { teamChannelRegistry, TeamChannelRegistry } from './team-channel-registry.js';
import type {
  GroupSessionKey,
  PeerBotInfo,
  PeerBotIdentity,
} from '../../channel/team-mode/team-channel.js';

const logger = createLogger('team-mode/peer-roster');

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min

interface CacheEntry {
  roster: PeerBotInfo[];
  expiresAt: number;
}

export interface PeerRosterServiceDeps {
  agentManager: AgentManager;
  /** 默认用全局 teamChannelRegistry，测试时可注入 mock */
  registry?: TeamChannelRegistry;
  /** 缓存 TTL（毫秒），默认 5 min */
  ttlMs?: number;
}

export class PeerRosterService {
  private cache = new Map<string, CacheEntry>();
  private agentManager: AgentManager;
  private registry: TeamChannelRegistry;
  private ttlMs: number;
  private unsubscribeMembership: (() => void) | null = null;

  constructor(deps: PeerRosterServiceDeps) {
    this.agentManager = deps.agentManager;
    this.registry = deps.registry ?? teamChannelRegistry;
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;

    // 订阅成员变更，立即失效该群所有缓存项
    this.unsubscribeMembership = this.registry.onMembershipChanged((key) => {
      this.invalidateGroup(key);
    });
  }

  /**
   * 构建群里同事的 roster
   *
   * @returns PeerBotInfo[]（不含自己），无同事返回 []
   */
  async buildRoster(
    agentId: string,
    groupSessionKey: GroupSessionKey,
  ): Promise<PeerBotInfo[]> {
    const cacheKey = makeCacheKey(agentId, groupSessionKey);

    // Step 1: 查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug(`缓存命中 agentId=${agentId} key=${groupSessionKey} peers=${cached.roster.length}`);
      return cached.roster;
    }

    // Step 2: 解析 adapter
    const adapter = this.registry.resolve(groupSessionKey);
    if (!adapter) {
      logger.warn(
        `未找到 channel adapter，team-mode 降级为空 roster: agentId=${agentId} key=${groupSessionKey}`,
      );
      // 缓存空结果一段较短时间，避免每次重复 resolve
      this.setCache(cacheKey, [], Math.min(this.ttlMs, 60_000));
      return [];
    }

    // Step 3: adapter 列出群里 bot 身份
    let identities: PeerBotIdentity[];
    try {
      identities = await adapter.listPeerBots(groupSessionKey, agentId);
    } catch (err) {
      logger.error(
        `adapter.listPeerBots 失败 agentId=${agentId} key=${groupSessionKey} channel=${adapter.channelType}`,
        err,
      );
      // 失败兜底：返回上次缓存（即使过期），实在没有就返回空
      if (cached) {
        logger.warn(`使用过期缓存兜底 peers=${cached.roster.length}`);
        return cached.roster;
      }
      return [];
    }

    if (identities.length === 0) {
      logger.debug(`adapter 返回空 roster agentId=${agentId} key=${groupSessionKey}`);
      this.setCache(cacheKey, [], this.ttlMs);
      return [];
    }

    // Step 4-5: AgentManager 补齐元信息 + 过滤非 active
    const roster: PeerBotInfo[] = [];
    for (const identity of identities) {
      // 防御：identity 自带 selfAgentId 排除应在 adapter 里做，这里再兜一层
      if (identity.agentId === agentId) {
        logger.warn(`adapter 未排除自己 agentId=${agentId} (跳过)`);
        continue;
      }
      const peer = this.agentManager.getAgent(identity.agentId);
      if (!peer) {
        logger.warn(
          `peer agent 在 AgentManager 找不到，可能已删除: agentId=${identity.agentId}`,
        );
        continue;
      }
      if (peer.status !== 'active') {
        logger.debug(
          `peer 非 active 跳过: agentId=${identity.agentId} status=${peer.status}`,
        );
        continue;
      }
      roster.push({
        agentId: identity.agentId,
        mentionId: identity.mentionId,
        name: peer.name,
        emoji: peer.emoji || '🤖',
        role: peer.role || 'general',
        // capabilityHint 留待未来从 SOUL.md / capability_graph 抽
      });
    }

    // Step 6: 落缓存
    this.setCache(cacheKey, roster, this.ttlMs);

    logger.info(
      `构建 roster agentId=${agentId} key=${groupSessionKey} channel=${adapter.channelType} ` +
        `identities=${identities.length} active_peers=${roster.length}`,
    );

    return roster;
  }

  /**
   * 失效一个群的所有缓存项（任意 agentId 视角）
   *
   * 触发场景：
   *   - 渠道成员变更事件
   *   - BindingRouter 新增 / 删除绑定时
   */
  invalidateGroup(groupSessionKey: GroupSessionKey): void {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.endsWith(`|${groupSessionKey}`)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`失效 group ${groupSessionKey} 缓存项数=${count}`);
    }
  }

  /**
   * 失效一个 agent 的所有缓存项（agent 删除 / 状态变更时调）
   */
  invalidateAgent(agentId: string): void {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${agentId}|`)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`失效 agent ${agentId} 缓存项数=${count}`);
    }
  }

  /**
   * 全部失效（测试 / 紧急回退用）
   */
  invalidateAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    if (size > 0) {
      logger.info(`全部失效 缓存项数=${size}`);
    }
  }

  /**
   * 清理资源（dispose 时调）
   */
  dispose(): void {
    if (this.unsubscribeMembership) {
      this.unsubscribeMembership();
      this.unsubscribeMembership = null;
    }
    this.cache.clear();
  }

  private setCache(key: string, roster: PeerBotInfo[], ttlMs: number): void {
    this.cache.set(key, {
      roster,
      expiresAt: Date.now() + ttlMs,
    });
  }
}

function makeCacheKey(agentId: string, groupSessionKey: GroupSessionKey): string {
  return `${agentId}|${groupSessionKey}`;
}
