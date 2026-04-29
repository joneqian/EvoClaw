/**
 * TeamChannelRegistry — TeamChannelAdapter 的全局注册表
 *
 * 职责：
 * - 注册各 channel 的 TeamChannelAdapter 实例（feishu / ilink / wecom / slack ...）
 * - 按 GroupSessionKey 前缀（"feishu:..."）路由到对应 adapter
 * - 转发"群成员变更"事件给订阅者（peer-roster-service 用来失效缓存）
 *
 * 单例使用：
 *   import { teamChannelRegistry } from '.../team-channel-registry';
 *   teamChannelRegistry.register('feishu', new FeishuTeamChannel(deps));
 */

import { createLogger } from '../../infrastructure/logger.js';
import type { GroupSessionKey, TeamChannelAdapter } from '../../channel/team-mode/team-channel.js';

const logger = createLogger('team-mode/registry');

type MembershipChangeHandler = (key: GroupSessionKey) => void;

export class TeamChannelRegistry {
  private adapters = new Map<string, TeamChannelAdapter>();
  private membershipHandlers = new Set<MembershipChangeHandler>();

  /**
   * 注册一个 channel 的 adapter
   *
   * 同 channelType 重复注册会替换旧实例（开发热重载场景），打 warn 日志。
   * 注册时如果 adapter 实现了 onGroupMembershipChanged，自动桥接到本注册表的事件流。
   */
  register(channelType: string, adapter: TeamChannelAdapter): void {
    if (this.adapters.has(channelType)) {
      logger.warn(`重复注册 channel adapter: ${channelType}, 旧实例被替换`);
    }
    if (adapter.channelType !== channelType) {
      logger.warn(
        `注册 channelType 与 adapter.channelType 不一致: ${channelType} vs ${adapter.channelType}, 以注册时传入的 channelType 为准`,
      );
    }
    this.adapters.set(channelType, adapter);
    logger.info(`注册 team-channel adapter: ${channelType}`);

    // 桥接成员变更事件到注册表全局事件流
    if (adapter.onGroupMembershipChanged) {
      adapter.onGroupMembershipChanged((key) => {
        logger.debug(`channel ${channelType} 成员变更: ${key}`);
        this.notifyMembershipChanged(key);
      });
    }
  }

  /**
   * 注销 adapter（测试 / 热重载用）
   */
  unregister(channelType: string): void {
    if (this.adapters.delete(channelType)) {
      logger.info(`注销 team-channel adapter: ${channelType}`);
    }
  }

  /**
   * 按 GroupSessionKey 解析对应 adapter
   *
   * 解析规则：取 key 第一段冒号前作为 channelType
   *   "feishu:chat:oc_xxx" → "feishu"
   *   "slack:channel:Cxx"  → "slack"
   *
   * @returns adapter 实例，未注册返回 null（调用方按降级处理）
   */
  resolve(groupSessionKey: GroupSessionKey): TeamChannelAdapter | null {
    const colonIdx = groupSessionKey.indexOf(':');
    if (colonIdx <= 0) {
      logger.warn(`groupSessionKey 格式错误（缺前缀）: ${groupSessionKey}`);
      return null;
    }
    const channelType = groupSessionKey.slice(0, colonIdx);
    const adapter = this.adapters.get(channelType);
    if (!adapter) {
      logger.debug(`未找到 channel adapter: ${channelType} (key=${groupSessionKey})`);
      return null;
    }
    return adapter;
  }

  /**
   * 直接按 channelType 取 adapter（已知 channel 时用）
   */
  resolveByType(channelType: string): TeamChannelAdapter | null {
    return this.adapters.get(channelType) ?? null;
  }

  /**
   * 列出所有已注册的 channelType
   */
  listChannelTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 订阅"群成员变更"事件（peer-roster-service 用）
   *
   * @returns 退订函数
   */
  onMembershipChanged(handler: MembershipChangeHandler): () => void {
    this.membershipHandlers.add(handler);
    return () => {
      this.membershipHandlers.delete(handler);
    };
  }

  /**
   * 主动触发成员变更（除 adapter 自动桥接外，BindingRouter 也可以调来失效缓存）
   */
  notifyMembershipChanged(key: GroupSessionKey): void {
    if (this.membershipHandlers.size === 0) {
      logger.debug(`成员变更无订阅者: ${key}`);
      return;
    }
    logger.debug(`广播成员变更 ${key} 到 ${this.membershipHandlers.size} 个订阅者`);
    for (const handler of this.membershipHandlers) {
      try {
        handler(key);
      } catch (err) {
        logger.error('membership handler 抛错', err);
      }
    }
  }

  /**
   * 重置（仅测试用）
   */
  reset(): void {
    this.adapters.clear();
    this.membershipHandlers.clear();
  }
}

/** 全局单例 */
export const teamChannelRegistry = new TeamChannelRegistry();
